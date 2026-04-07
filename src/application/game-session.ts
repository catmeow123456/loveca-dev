/**
 * 游戏会话管理
 *
 * 充当服务器角色，维护权威游戏状态，处理动作并自动推进阶段。
 * 为每个玩家提供独立的游戏状态读取接口。
 * 当前尚未实现联机所需的状态脱敏，仍返回权威状态副本。
 *
 * 支持 GameMode：
 * - DEBUG: 调试模式，双人同设备手动操作
 * - SOLITAIRE: 对墙打模式，系统自动跳过对手阶段
 */

import { GameService, type DeckConfig, type GameOperationResult } from './game-service.js';
import {
  FaceState,
  GamePhase,
  GameMode,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../shared/types/enums.js';
import type { GameState, InspectionContextState } from '../domain/entities/game.js';
import { getActivePlayer } from '../domain/entities/game.js';
import type { PlayerState } from '../domain/entities/player.js';
import type { BaseZoneState } from '../domain/entities/zone.js';
import {
  isPlayerActive,
  getActivePlayerId as getActivePlayerIdFromConfig,
} from '../shared/phase-config/index.js';
import { GameActionType, type GameAction } from './actions.js';
import {
  createMulliganAction,
  createEndPhaseAction,
  createConfirmSubPhaseAction,
  createConfirmJudgmentAction,
  createManualMoveCardAction,
  createPlayMemberAction,
  createConfirmScoreAction,
  createPerformCheerAction,
  createSelectSuccessCardAction,
  createSetLiveCardAction,
  createTapEnergyAction,
  createTapMemberAction,
} from './actions.js';
import {
  buildViewWindowState,
  createPublicObjectId,
  getSeatByPlayerIndex,
  getSeatForPlayer,
  getWindowSignature,
  projectPlayerViewState,
} from '../online/projector.js';
import { fromTransport, toTransport } from '../online/serde.js';
import {
  isZoneCardPublicFront,
  isZonePubliclyObservable,
  isZoneStrictPublicTableMove,
} from '../online/visibility.js';
import type {
  AuthoritativeRecoveryFrame,
  MatchCommandRecord,
  MatchSnapshotSummary,
  PlayerViewState,
  PlayerRecoveryFrame,
  PrivateEvent,
  PrivateEventDraft,
  PublicCardInfo,
  PublicEvent,
  PublicEventDraft,
  PublicEventSource,
  PublicWindowType,
  PublicZoneRef,
  SealedAuditRecord,
  SealedAuditRecordDraft,
  Seat,
  WindowStatus,
} from '../online/types.js';
import type {
  GameCommand,
  MulliganCommand,
  SetLiveCardCommand,
  TapMemberCommand,
  TapEnergyCommand,
  EndPhaseCommand,
  OpenInspectionCommand,
  RevealCheerCardCommand,
  RevealInspectedCardCommand,
  MoveInspectedCardToZoneCommand,
  MoveInspectedCardToTopCommand,
  MoveInspectedCardToBottomCommand,
  ReorderInspectedCardCommand,
  MoveResolutionCardToZoneCommand,
  MoveTableCardCommand,
  MoveMemberToSlotCommand,
  AttachEnergyToMemberCommand,
  PlayMemberToSlotCommand,
  MovePublicCardToWaitingRoomCommand,
  MovePublicCardToHandCommand,
  FinishInspectionCommand,
  ConfirmStepCommand,
  ConfirmPerformanceOutcomeCommand,
  SubmitJudgmentCommand,
  SubmitScoreCommand,
  SelectSuccessLiveCommand,
  DrawCardToHandCommand,
  DrawEnergyToZoneCommand,
  ReturnHandCardToTopCommand,
} from './game-commands.js';
import { GameCommandType } from './game-commands.js';
import {
  addCardToInspectionZone,
  removeCardFromInspectionZone,
  revealInspectionZoneCard,
  reorderInspectionZoneCard,
  removeCardFromPlayerZone,
  addCardToPlayerZone,
} from './action-handlers/zone-operations.js';

// ============================================
// 类型定义
// ============================================

/**
 * 自动推进的阶段列表
 * 这些阶段不需要玩家主动操作，会自动执行并推进到下一阶段
 *
 * 注意：PERFORMANCE_PHASE 和 LIVE_RESULT_PHASE 不在此列表中，
 * 因为它们需要给 UI 时间展示动画（Cheer、判定结果等）
 */
const AUTO_ADVANCE_PHASES: readonly GamePhase[] = [
  GamePhase.ACTIVE_PHASE,
  GamePhase.ENERGY_PHASE,
  GamePhase.DRAW_PHASE,
];

/**
 * 自动推进的最大次数限制，防止无限循环
 */
const MAX_AUTO_ADVANCE_ITERATIONS = 20;

/**
 * 游戏会话事件类型
 */
export type GameSessionEvent =
  | { type: 'PHASE_CHANGED'; phase: GamePhase; activePlayerId: string }
  | { type: 'TURN_CHANGED'; turnNumber: number; activePlayerId: string }
  | { type: 'GAME_ENDED'; winnerId: string | null }
  | { type: 'ACTION_EXECUTED'; action: GameAction; playerId: string };

/**
 * 游戏会话选项
 */
export interface GameSessionOptions {
  /** 游戏模式（默认调试模式） */
  gameMode?: GameMode;
  /** 事件监听器 */
  onEvent?: (event: GameSessionEvent) => void;
}

interface StateTransitionOptions {
  readonly source?: PublicEventSource;
  readonly actorPlayerId?: string;
  readonly declarationActionType?: string;
  readonly declarationPublicValue?: string | number | boolean | null;
  readonly extraPublicEvents?: readonly PublicEventDraft[];
  readonly privateEventsBySeat?: Partial<Record<Seat, readonly PrivateEventDraft[]>>;
  readonly sealedAuditRecords?: readonly SealedAuditRecordDraft[];
}

interface CommandExecutionResult {
  readonly success: boolean;
  readonly gameState: GameState;
  readonly error?: string;
  readonly declarationType?: string;
  readonly declarationPublicValue?: string | number | boolean | null;
  readonly extraPublicEvents?: readonly PublicEventDraft[];
  readonly privateEventsBySeat?: Partial<Record<Seat, readonly PrivateEventDraft[]>>;
  readonly sealedAuditRecords?: readonly SealedAuditRecordDraft[];
}

// ============================================
// GameSession 类
// ============================================

/**
 * 游戏会话
 *
 * 管理单场游戏的生命周期，提供：
 * 1. 权威状态管理
 * 2. 动作处理与验证
 * 3. 自动阶段推进
 * 4. 玩家视角状态获取
 * 5. 对墙打模式下对手阶段自动跳过
 */
export class GameSession {
  private gameService: GameService;
  private authorityState: GameState | null = null;
  private _gameMode: GameMode;
  private options: GameSessionOptions;
  private publicEvents: PublicEvent[] = [];
  private publicEventSeq = 0;
  private privateEventsBySeat: Record<Seat, PrivateEvent[]> = { FIRST: [], SECOND: [] };
  private privateEventSeq = 0;
  private sealedAuditRecords: SealedAuditRecord[] = [];
  private sealedAuditSeq = 0;
  private commandLog: MatchCommandRecord[] = [];
  private commandSeq = 0;
  private snapshotHistory: MatchSnapshotSummary[] = [];
  private authoritySnapshots = new Map<number, GameState>();

  constructor(options: GameSessionOptions = {}) {
    this.gameService = new GameService();
    this._gameMode = options.gameMode ?? GameMode.DEBUG;
    this.options = options;
  }

  /**
   * 获取权威游戏状态（仅供调试）
   */
  get state(): GameState | null {
    return this.authorityState;
  }

  /**
   * 获取当前游戏模式
   */
  get gameMode(): GameMode {
    return this._gameMode;
  }

  /**
   * 设置游戏模式（支持游戏内切换）
   */
  set gameMode(mode: GameMode) {
    this._gameMode = mode;
  }

  /**
   * 创建新游戏
   */
  createGame(
    gameId: string,
    player1Id: string,
    player1Name: string,
    player2Id: string,
    player2Name: string
  ): GameState {
    this.publicEvents = [];
    this.publicEventSeq = 0;
    this.privateEventsBySeat = { FIRST: [], SECOND: [] };
    this.privateEventSeq = 0;
    this.sealedAuditRecords = [];
    this.sealedAuditSeq = 0;
    this.commandLog = [];
    this.commandSeq = 0;
    this.snapshotHistory = [];
    this.authoritySnapshots = new Map();

    const initialState = this.gameService.createGame(
      gameId,
      player1Id,
      player1Name,
      player2Id,
      player2Name
    );
    this.setAuthorityState(initialState, { source: 'SYSTEM' });
    return initialState;
  }

  /**
   * 初始化游戏（设置卡组、抽初始手牌等）
   * 初始化后自动推进到第一个需要玩家操作的阶段
   */
  initializeGame(player1Deck: DeckConfig, player2Deck: DeckConfig): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未创建',
      };
    }

    const result = this.gameService.initializeGame(this.authorityState, player1Deck, player2Deck);

    if (result.success) {
      this.setAuthorityState(result.gameState, { source: 'SYSTEM' });
      // 自动推进阶段
      this.autoAdvance(this.authorityState);
    }

    return {
      ...result,
      gameState: this.authorityState,
    };
  }

  /**
   * 处理玩家动作
   *
   * 执行动作后自动推进阶段（如果需要）。
   * 对墙打模式下，会在玩家动作完成后自动触发对手跳过动作。
   */
  dispatch(action: GameAction): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未开始',
      };
    }

    const result = this.gameService.processAction(this.authorityState, action);

    if (result.success) {
      this.setAuthorityState(result.gameState, {
        source: 'PLAYER',
        actorPlayerId: action.playerId,
        declarationActionType: action.type,
        privateEventsBySeat: buildLegacyActionPrivateEvents(result.gameState, action),
        sealedAuditRecords: buildLegacyActionAuditRecords(result.gameState, action),
      });

      // 发送动作执行事件
      this.emitEvent({
        type: 'ACTION_EXECUTED',
        action,
        playerId: action.playerId,
      });

      // 自动推进阶段
      this.autoAdvance(this.authorityState);

      // 对墙打模式：自动处理对手阶段
      if (this._gameMode === GameMode.SOLITAIRE) {
        this.handleSolitaireAutoSkip(action);
      }
    }

    return {
      ...result,
      gameState: this.authorityState,
    };
  }

  /**
   * 执行语义化命令
   *
   * Stage 3 起用于逐步替代直接暴露给 UI 的万能动作。
   * 当前优先覆盖检视区流程和公开声明类命令。
   */
  executeCommand(command: GameCommand): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未开始',
      };
    }

    const idempotencyHit = this.resolveIdempotentCommand(command);
    if (idempotencyHit) {
      return idempotencyHit;
    }

    const validated = this.validateCommand(this.authorityState, command);
    if (validated) {
      this.recordCommand(command, 'REJECTED', validated);
      this.appendSealedAuditRecord(this.authorityState, {
        type: 'COMMAND_REJECTED',
        actorSeat: getSeatForPlayer(this.authorityState, command.playerId) ?? undefined,
        payload: {
          commandType: command.type,
          playerId: command.playerId,
          idempotencyKey: command.idempotencyKey ?? null,
          error: validated,
        },
      });
      return {
        success: false,
        gameState: this.authorityState,
        error: validated,
      };
    }

    const result = this.applyCommand(this.authorityState, command);
    if (!result.success) {
      this.recordCommand(command, 'REJECTED', result.error);
      this.appendSealedAuditRecord(this.authorityState, {
        type: 'COMMAND_REJECTED',
        actorSeat: getSeatForPlayer(this.authorityState, command.playerId) ?? undefined,
        payload: {
          commandType: command.type,
          playerId: command.playerId,
          idempotencyKey: command.idempotencyKey ?? null,
          error: result.error ?? '命令执行失败',
        },
      });
      return {
        success: false,
        gameState: result.gameState,
        error: result.error,
      };
    }

    this.setAuthorityState(result.gameState, {
      source: 'PLAYER',
      actorPlayerId: command.playerId,
      declarationActionType: result.declarationType,
      declarationPublicValue: result.declarationPublicValue,
      extraPublicEvents: result.extraPublicEvents,
      privateEventsBySeat: result.privateEventsBySeat,
      sealedAuditRecords: result.sealedAuditRecords,
    });
    this.recordCommand(command, 'ACCEPTED');

    this.autoAdvance(this.authorityState);
    if (this._gameMode === GameMode.SOLITAIRE) {
      this.handleSolitaireAutoSkipAfterCommand(command.playerId);
    }

    return {
      success: true,
      gameState: this.authorityState,
    };
  }

  private resolveIdempotentCommand(command: GameCommand): GameOperationResult | null {
    if (!this.authorityState || !command.idempotencyKey) {
      return null;
    }

    const existingRecord = this.commandLog.find(
      (record) =>
        record.playerId === command.playerId && record.idempotencyKey === command.idempotencyKey
    );
    if (!existingRecord) {
      return null;
    }

    const existingComparablePayload = createComparableCommandPayload(existingRecord.payload);
    const incomingComparablePayload = createComparableCommandPayload(command);
    if (!areTransportValuesEqual(existingComparablePayload, incomingComparablePayload)) {
      const error = '同一幂等键对应的命令载荷不一致';
      this.appendSealedAuditRecord(this.authorityState, {
        type: 'COMMAND_IDEMPOTENCY_CONFLICT',
        actorSeat: getSeatForPlayer(this.authorityState, command.playerId) ?? undefined,
        payload: {
          commandType: command.type,
          playerId: command.playerId,
          idempotencyKey: command.idempotencyKey,
          existingCommandType: existingRecord.commandType,
          existingPayload: existingComparablePayload,
          incomingPayload: incomingComparablePayload,
        },
      });
      return {
        success: false,
        gameState: this.authorityState,
        error,
      };
    }

    this.appendSealedAuditRecord(this.authorityState, {
      type: 'COMMAND_IDEMPOTENCY_REUSED',
      actorSeat: getSeatForPlayer(this.authorityState, command.playerId) ?? undefined,
      payload: {
        commandType: command.type,
        playerId: command.playerId,
        idempotencyKey: command.idempotencyKey,
        commandSeq: existingRecord.seq,
        status: existingRecord.status,
      },
    });

    if (existingRecord.status === 'REJECTED') {
      return {
        success: false,
        gameState: this.authorityState,
        error: existingRecord.error ?? '命令执行失败',
      };
    }

    return {
      success: true,
      gameState: this.authorityState,
    };
  }

  /**
   * 手动推进阶段（用于需要玩家确认的阶段转换）
   */
  advancePhase(): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未开始',
      };
    }

    const result = this.gameService.advancePhase(this.authorityState);

    if (result.success) {
      this.setAuthorityState(result.gameState, { source: 'SYSTEM' });

      // 发送阶段变更事件
      this.emitEvent({
        type: 'PHASE_CHANGED',
        phase: result.gameState.currentPhase,
        activePlayerId: getActivePlayer(result.gameState).id,
      });

      // 继续自动推进（如果新阶段是自动阶段）
      this.autoAdvance(this.authorityState);
    }

    return {
      ...result,
      gameState: this.authorityState,
    };
  }

  /**
   * 获取指定玩家视角的游戏状态
   *
   * 返回兼容旧 UI 的脱敏快照：
   * - 保留公开区域与当前玩家自有区域的真实对象
   * - 对对手隐藏区只保留数量，不暴露真实卡牌 ID
   * - 移除不应继续由联机 UI 直接消费的私密历史细节
   */
  getStateForPlayer(playerId: string): GameState | null {
    if (!this.authorityState) {
      return null;
    }

    return createPlayerCompatibilityGameState(this.authorityState, playerId);
  }

  /**
   * 获取指定玩家的联机视图快照
   */
  getPlayerViewState(playerId: string): PlayerViewState | null {
    if (!this.authorityState) {
      return null;
    }

    return projectPlayerViewState(this.authorityState, playerId, {
      seq: this.publicEventSeq,
      gameMode: this._gameMode,
    });
  }

  /**
   * 获取指定序号之后的公共事件
   */
  getPublicEventsSince(seq: number): readonly PublicEvent[] {
    return this.publicEvents.filter((event) => event.seq > seq);
  }

  getPrivateEventsSince(playerId: string, seq: number): readonly PrivateEvent[] {
    if (!this.authorityState) {
      return [];
    }

    const seat = getSeatForPlayer(this.authorityState, playerId);
    if (!seat) {
      return [];
    }

    return this.privateEventsBySeat[seat].filter((event) => event.seq > seq);
  }

  getSealedAuditSince(seq: number): readonly SealedAuditRecord[] {
    return this.sealedAuditRecords.filter((record) => record.seq > seq);
  }

  getCommandLogSince(seq: number): readonly MatchCommandRecord[] {
    return this.commandLog.filter((record) => record.seq > seq);
  }

  getSnapshotHistory(): readonly MatchSnapshotSummary[] {
    return this.snapshotHistory;
  }

  getAuthoritySnapshotAtOrBefore(publicSeq: number): GameState | null {
    const candidateSeq = this.getRecoverySnapshotSeqAtOrBefore(publicSeq);

    if (candidateSeq === undefined) {
      return null;
    }

    const snapshot = this.authoritySnapshots.get(candidateSeq);
    return snapshot ? cloneGameState(snapshot) : null;
  }

  getPlayerRecoveryFrame(playerId: string, publicSeq: number): PlayerRecoveryFrame | null {
    if (!this.authorityState) {
      return null;
    }

    const seat = getSeatForPlayer(this.authorityState, playerId);
    if (!seat) {
      return null;
    }

    const snapshotSeq = this.getRecoverySnapshotSeqAtOrBefore(publicSeq);
    if (snapshotSeq === undefined) {
      return null;
    }

    const snapshot = this.authoritySnapshots.get(snapshotSeq);
    if (!snapshot) {
      return null;
    }

    const clonedSnapshot = cloneGameState(snapshot);
    return {
      matchId: clonedSnapshot.gameId,
      viewerSeat: seat,
      snapshotPublicSeq: snapshotSeq,
      currentPublicSeq: this.publicEventSeq,
      gameState: createPlayerCompatibilityGameState(clonedSnapshot, playerId),
      playerViewState: projectPlayerViewState(clonedSnapshot, playerId, {
        seq: snapshotSeq,
        gameMode: this._gameMode,
      }),
      publicEvents: this.getPublicEventsSince(snapshotSeq),
      privateEvents: this.privateEventsBySeat[seat].filter(
        (event) => event.relatedPublicSeq > snapshotSeq
      ),
    };
  }

  getAuthoritativeRecoveryFrame(publicSeq: number): AuthoritativeRecoveryFrame | null {
    if (!this.authorityState) {
      return null;
    }

    const snapshotSeq = this.getRecoverySnapshotSeqAtOrBefore(publicSeq);
    if (snapshotSeq === undefined) {
      return null;
    }

    const snapshot = this.authoritySnapshots.get(snapshotSeq);
    if (!snapshot) {
      return null;
    }

    return {
      matchId: this.authorityState.gameId,
      snapshotPublicSeq: snapshotSeq,
      currentPublicSeq: this.publicEventSeq,
      gameState: cloneGameState(snapshot),
      publicEvents: this.getPublicEventsSince(snapshotSeq),
      sealedAudit: this.sealedAuditRecords.filter(
        (record) => record.relatedPublicSeq > snapshotSeq
      ),
      commandLog: this.commandLog.filter((record) => record.resultingPublicSeq > snapshotSeq),
    };
  }

  private getRecoverySnapshotSeqAtOrBefore(publicSeq: number): number | undefined {
    const snapshotSeqs = [...this.authoritySnapshots.keys()].sort((left, right) => left - right);
    if (snapshotSeqs.length === 0) {
      return undefined;
    }

    return snapshotSeqs.filter((seq) => seq <= publicSeq).at(-1) ?? snapshotSeqs[0];
  }

  /**
   * 获取当前公共事件序号
   */
  getCurrentPublicEventSeq(): number {
    return this.publicEventSeq;
  }

  /**
   * 获取当前活跃玩家 ID
   * 使用 phase-config 统一判断逻辑
   */
  getActivePlayerId(): string | null {
    if (!this.authorityState) {
      return null;
    }
    return getActivePlayerIdFromConfig(this.authorityState) ?? null;
  }

  /**
   * 检查指定玩家是否是当前活跃玩家
   * 使用 phase-config 统一判断逻辑，支持子阶段派生的活跃玩家
   */
  isActivePlayer(playerId: string): boolean {
    if (!this.authorityState) return false;
    return isPlayerActive(this.authorityState, playerId);
  }

  // ============================================
  // 私有方法
  // ============================================

  private validateCommand(state: GameState, command: GameCommand): string | null {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return '玩家不存在';
    }

    const canActError = this.validateCommandActor(state, command.playerId);
    if (canActError) {
      return canActError;
    }

    const inspectionContextError = this.validateInspectionCommandContext(state, command);
    if (inspectionContextError) {
      return inspectionContextError;
    }

    const commandAvailabilityError = this.validateCommandAvailability(state, command);
    if (commandAvailabilityError) {
      return commandAvailabilityError;
    }

    switch (command.type) {
      case GameCommandType.MULLIGAN: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        for (const cardId of command.cardIdsToMulligan) {
          if (!player.hand.cardIds.includes(cardId)) {
            return '换牌列表中存在不在手牌中的卡牌';
          }
        }
        return null;
      }
      case GameCommandType.SET_LIVE_CARD: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (!player.hand.cardIds.includes(command.cardId)) {
          return '卡牌当前不在手牌';
        }
        return null;
      }
      case GameCommandType.TAP_MEMBER: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (player.memberSlots.slots[command.slot] !== command.cardId) {
          return '卡牌当前不在指定成员槽位';
        }
        return null;
      }
      case GameCommandType.TAP_ENERGY: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (!player.energyZone.cardIds.includes(command.cardId)) {
          return '卡牌当前不在能量区';
        }
        return null;
      }
      case GameCommandType.END_PHASE:
        return null;
      case GameCommandType.OPEN_INSPECTION: {
        if (command.count <= 0) {
          return '检视数量必须大于 0';
        }
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        const sourceZone =
          command.sourceZone === ZoneType.ENERGY_DECK ? player.energyDeck : player.mainDeck;
        if (sourceZone.cardIds.length < command.count) {
          return '来源区域卡牌数量不足';
        }
        return null;
      }
      case GameCommandType.REVEAL_CHEER_CARD: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (player.mainDeck.cardIds.length === 0) {
          return '主卡组没有可翻开的应援牌';
        }
        return null;
      }
      case GameCommandType.REVEAL_INSPECTED_CARD:
      case GameCommandType.MOVE_INSPECTED_CARD_TO_TOP:
      case GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM:
      case GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE: {
        return this.validateInspectedCardOwnership(state, command.playerId, command.cardId);
      }
      case GameCommandType.REORDER_INSPECTED_CARD: {
        const ownershipError = this.validateInspectedCardOwnership(
          state,
          command.playerId,
          command.cardId
        );
        if (ownershipError) {
          return ownershipError;
        }
        const ownedCardIds = getOwnedInspectionCardIds(state, command.playerId);
        if (command.toIndex < 0 || command.toIndex >= ownedCardIds.length) {
          return '目标检视位置非法';
        }
        return null;
      }
      case GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE: {
        const ownershipError = this.validateResolutionCardOwnership(
          state,
          command.playerId,
          command.cardId
        );
        if (ownershipError) {
          return ownershipError;
        }
        if (
          command.toZone === ZoneType.MAIN_DECK &&
          command.position !== undefined &&
          command.position !== 'TOP' &&
          command.position !== 'BOTTOM'
        ) {
          return '主卡组移动位置非法';
        }
        return null;
      }
      case GameCommandType.MOVE_TABLE_CARD:
        if (
          !isZoneStrictPublicTableMove(command.fromZone) ||
          !isZoneStrictPublicTableMove(command.toZone)
        ) {
          return '跨公开/隐藏边界的移动必须使用专用命令';
        }
        if (!state.cardRegistry.has(command.cardId)) {
          return '卡牌不存在';
        }
        if (
          !isCardInOwnedZone(
            state,
            command.playerId,
            command.fromZone,
            command.cardId,
            command.sourceSlot
          )
        ) {
          return '卡牌当前不在声明的来源区域';
        }
        if (command.fromZone === ZoneType.MEMBER_SLOT && !command.sourceSlot) {
          return '成员区来源移动必须声明来源槽位';
        }
        if (command.toZone === ZoneType.MEMBER_SLOT && !command.targetSlot) {
          return '成员区目标移动必须声明目标槽位';
        }
        return null;
      case GameCommandType.MOVE_MEMBER_TO_SLOT: {
        if (command.sourceSlot === command.targetSlot) {
          return '目标槽位不能与来源槽位相同';
        }
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (player.memberSlots.slots[command.sourceSlot] !== command.cardId) {
          return '卡牌当前不在来源成员槽位';
        }
        return null;
      }
      case GameCommandType.ATTACH_ENERGY_TO_MEMBER: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (!player.memberSlots.slots[command.targetSlot]) {
          return '目标成员槽位没有成员卡';
        }
        const card = state.cardRegistry.get(command.cardId);
        if (!card || card.data.cardType !== 'ENERGY') {
          return '只有能量牌可以附着到成员下方';
        }
        if (!isCardInOwnedZone(state, command.playerId, command.fromZone, command.cardId)) {
          return '能量牌当前不在声明的来源区域';
        }
        return null;
      }
      case GameCommandType.PLAY_MEMBER_TO_SLOT: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (!player.hand.cardIds.includes(command.cardId)) {
          return '卡牌当前不在手牌';
        }
        const card = state.cardRegistry.get(command.cardId);
        if (!card || card.data.cardType !== 'MEMBER') {
          return '只有成员卡可以登场到成员区';
        }
        return null;
      }
      case GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM:
      case GameCommandType.MOVE_PUBLIC_CARD_TO_HAND: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        const card = state.cardRegistry.get(command.cardId);
        if (!card) {
          return '卡牌不存在';
        }
        if (
          !isCardInOwnedZone(
            state,
            command.playerId,
            command.fromZone,
            command.cardId,
            command.sourceSlot
          )
        ) {
          return '卡牌当前不在声明的公开区域';
        }
        return null;
      }
      case GameCommandType.FINISH_INSPECTION:
        if (getOwnedInspectionCardIds(state, command.playerId).length > 0) {
          return '检视区仍有未处理的卡牌';
        }
        return null;
      case GameCommandType.CONFIRM_STEP: {
        if (state.currentSubPhase !== command.subPhase) {
          return `当前子阶段不是 ${command.subPhase}`;
        }
        return null;
      }
      case GameCommandType.DRAW_CARD_TO_HAND: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (player.mainDeck.cardIds.length === 0) {
          return '主卡组没有可抽取的卡牌';
        }
        return null;
      }
      case GameCommandType.DRAW_ENERGY_TO_ZONE: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (player.energyDeck.cardIds.length === 0) {
          return '能量卡组没有可放置的卡牌';
        }
        if (player.energyDeck.cardIds[0] !== command.cardId) {
          return '只能从能量卡组顶放置能量牌';
        }
        const card = state.cardRegistry.get(command.cardId);
        if (!card) {
          return '卡牌不存在';
        }
        if (card.data.cardType !== 'ENERGY') {
          return '只有能量牌可以放置到能量区';
        }
        return null;
      }
      case GameCommandType.RETURN_HAND_CARD_TO_TOP: {
        const player = state.players.find((candidate) => candidate.id === command.playerId);
        if (!player) {
          return '玩家不存在';
        }
        if (!player.hand.cardIds.includes(command.cardId)) {
          return '卡牌当前不在手牌';
        }
        return null;
      }
      case GameCommandType.SELECT_SUCCESS_LIVE: {
        if (!isCardInOwnedZone(state, command.playerId, ZoneType.LIVE_ZONE, command.cardId)) {
          return '卡牌当前不在己方 Live 区';
        }
        return null;
      }
      default:
        return null;
    }
  }

  private validateCommandAvailability(state: GameState, command: GameCommand): string | null {
    switch (command.type) {
      case GameCommandType.MULLIGAN:
        return state.currentPhase === GamePhase.MULLIGAN_PHASE ? null : '当前不是换牌阶段';
      case GameCommandType.SET_LIVE_CARD:
        return state.currentPhase === GamePhase.LIVE_SET_PHASE ? null : '当前不是 Live 设置阶段';
      case GameCommandType.TAP_ENERGY:
        return null;
      case GameCommandType.OPEN_INSPECTION:
      case GameCommandType.TAP_MEMBER:
      case GameCommandType.MOVE_TABLE_CARD:
      case GameCommandType.MOVE_MEMBER_TO_SLOT:
      case GameCommandType.ATTACH_ENERGY_TO_MEMBER:
      case GameCommandType.PLAY_MEMBER_TO_SLOT:
      case GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM:
      case GameCommandType.DRAW_CARD_TO_HAND:
      case GameCommandType.DRAW_ENERGY_TO_ZONE:
      case GameCommandType.RETURN_HAND_CARD_TO_TOP:
        return state.currentPhase === GamePhase.MAIN_PHASE ? null : '当前不是主要阶段';
      case GameCommandType.MOVE_PUBLIC_CARD_TO_HAND:
        return state.currentPhase === GamePhase.MAIN_PHASE ||
          state.currentPhase === GamePhase.LIVE_SET_PHASE
          ? null
          : '当前不是可回手阶段';
      case GameCommandType.REVEAL_CHEER_CARD:
      case GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE:
      case GameCommandType.CONFIRM_PERFORMANCE_OUTCOME:
      case GameCommandType.SUBMIT_JUDGMENT:
        return state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT
          ? null
          : '当前不是 Live 判定子阶段';
      case GameCommandType.SUBMIT_SCORE:
        return state.currentSubPhase === SubPhase.RESULT_SETTLEMENT ? null : '当前不是分数确认阶段';
      case GameCommandType.SELECT_SUCCESS_LIVE:
        return state.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS ||
          state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS
          ? null
          : '当前不是成功 Live 选择阶段';
      default:
        return null;
    }
  }

  private validateInspectionCommandContext(state: GameState, command: GameCommand): string | null {
    const inspectionContext = state.inspectionContext;

    if (!inspectionContext) {
      if (
        command.type === GameCommandType.MOVE_INSPECTED_CARD_TO_TOP ||
        command.type === GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM ||
        command.type === GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE ||
        command.type === GameCommandType.REVEAL_INSPECTED_CARD ||
        command.type === GameCommandType.REORDER_INSPECTED_CARD ||
        command.type === GameCommandType.FINISH_INSPECTION
      ) {
        return '当前没有进行中的检视流程';
      }
      return null;
    }

    if (command.playerId !== inspectionContext.ownerPlayerId) {
      return '当前正在等待检视玩家完成操作';
    }

    if (
      command.type !== GameCommandType.OPEN_INSPECTION &&
      command.type !== GameCommandType.REVEAL_INSPECTED_CARD &&
      command.type !== GameCommandType.MOVE_INSPECTED_CARD_TO_TOP &&
      command.type !== GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM &&
      command.type !== GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE &&
      command.type !== GameCommandType.REORDER_INSPECTED_CARD &&
      command.type !== GameCommandType.FINISH_INSPECTION
    ) {
      return '当前处于检视流程，请先完成检视';
    }

    return null;
  }

  private validateCommandActor(state: GameState, playerId: string): string | null {
    if (state.inspectionContext) {
      return state.inspectionContext.ownerPlayerId === playerId
        ? null
        : '当前正在等待检视玩家完成操作';
    }

    if (state.waitingPlayerId !== null) {
      return state.waitingPlayerId === playerId ? null : '当前不是该玩家的操作时机';
    }

    return isPlayerActive(state, playerId) ? null : '当前不是该玩家的操作时机';
  }

  private validateInspectedCardOwnership(
    state: GameState,
    playerId: string,
    cardId: string
  ): string | null {
    if (!state.inspectionContext) {
      return '当前没有进行中的检视流程';
    }

    if (state.inspectionContext.ownerPlayerId !== playerId) {
      return '不能操作不属于自己的检视牌';
    }

    if (!state.inspectionZone.cardIds.includes(cardId)) {
      return '卡牌当前不在检视区';
    }

    const card = state.cardRegistry.get(cardId);
    if (!card) {
      return '卡牌不存在';
    }

    if (card.ownerId !== playerId) {
      return '不能操作不属于自己的检视牌';
    }

    return null;
  }

  private validateResolutionCardOwnership(
    state: GameState,
    playerId: string,
    cardId: string
  ): string | null {
    if (!state.resolutionZone.cardIds.includes(cardId)) {
      return '卡牌当前不在解决区';
    }

    const card = state.cardRegistry.get(cardId);
    if (!card) {
      return '卡牌不存在';
    }

    if (card.ownerId !== playerId) {
      return '不能操作不属于自己的解决区卡牌';
    }

    return null;
  }

  private applyCommand(state: GameState, command: GameCommand): CommandExecutionResult {
    switch (command.type) {
      case GameCommandType.MULLIGAN:
        return this.applyMulliganCommand(state, command);
      case GameCommandType.SET_LIVE_CARD:
        return this.applySetLiveCardCommand(state, command);
      case GameCommandType.TAP_MEMBER:
        return this.applyTapMemberCommand(state, command);
      case GameCommandType.TAP_ENERGY:
        return this.applyTapEnergyCommand(state, command);
      case GameCommandType.END_PHASE:
        return this.applyEndPhaseCommand(state, command);
      case GameCommandType.OPEN_INSPECTION:
        return this.applyOpenInspectionCommand(state, command);
      case GameCommandType.REVEAL_CHEER_CARD:
        return this.applyRevealCheerCardCommand(state, command);
      case GameCommandType.REVEAL_INSPECTED_CARD:
        return this.applyRevealInspectedCardCommand(state, command);
      case GameCommandType.MOVE_INSPECTED_CARD_TO_TOP:
        return this.applyMoveInspectedCardToTopCommand(state, command);
      case GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM:
        return this.applyMoveInspectedCardToBottomCommand(state, command);
      case GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE:
        return this.applyMoveInspectedCardToZoneCommand(state, command);
      case GameCommandType.REORDER_INSPECTED_CARD:
        return this.applyReorderInspectedCardCommand(state, command);
      case GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE:
        return this.applyMoveResolutionCardToZoneCommand(state, command);
      case GameCommandType.MOVE_TABLE_CARD:
        return this.applyMoveTableCardCommand(state, command);
      case GameCommandType.MOVE_MEMBER_TO_SLOT:
        return this.applyMoveMemberToSlotCommand(state, command);
      case GameCommandType.ATTACH_ENERGY_TO_MEMBER:
        return this.applyAttachEnergyToMemberCommand(state, command);
      case GameCommandType.PLAY_MEMBER_TO_SLOT:
        return this.applyPlayMemberToSlotCommand(state, command);
      case GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM:
        return this.applyMovePublicCardToWaitingRoomCommand(state, command);
      case GameCommandType.MOVE_PUBLIC_CARD_TO_HAND:
        return this.applyMovePublicCardToHandCommand(state, command);
      case GameCommandType.FINISH_INSPECTION:
        return this.applyFinishInspectionCommand(state, command);
      case GameCommandType.CONFIRM_STEP:
        return this.applyConfirmStepCommand(state, command);
      case GameCommandType.CONFIRM_PERFORMANCE_OUTCOME:
        return this.applyConfirmPerformanceOutcomeCommand(state, command);
      case GameCommandType.SUBMIT_JUDGMENT:
        return this.applySubmitJudgmentCommand(state, command);
      case GameCommandType.SUBMIT_SCORE:
        return this.applySubmitScoreCommand(state, command);
      case GameCommandType.SELECT_SUCCESS_LIVE:
        return this.applySelectSuccessLiveCommand(state, command);
      case GameCommandType.DRAW_CARD_TO_HAND:
        return this.applyDrawCardToHandCommand(state, command);
      case GameCommandType.DRAW_ENERGY_TO_ZONE:
        return this.applyDrawEnergyToZoneCommand(state, command);
      case GameCommandType.RETURN_HAND_CARD_TO_TOP:
        return this.applyReturnHandCardToTopCommand(state, command);
      default:
        return {
          success: false,
          gameState: state,
          error: `未支持的命令: ${(command as GameCommand).type}`,
        };
    }
  }

  private applyMulliganCommand(state: GameState, command: MulliganCommand): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const result = this.gameService.processAction(
      state,
      createMulliganAction(command.playerId, command.cardIdsToMulligan)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'MULLIGAN',
      declarationPublicValue: command.cardIdsToMulligan.length,
      privateEventsBySeat: {
        [actorSeat]: [
          {
            type: 'MULLIGAN_RESOLVED',
            payload: {
              returnedCardIds: [...command.cardIdsToMulligan],
              handCardIds: [...getPlayerHandCardIds(result.gameState, command.playerId)],
            },
          },
        ],
      },
      sealedAuditRecords: [
        {
          type: 'MULLIGAN_RESOLVED',
          actorSeat,
          payload: {
            returnedCardIds: [...command.cardIdsToMulligan],
            handCardIds: [...getPlayerHandCardIds(result.gameState, command.playerId)],
          },
        },
      ],
    };
  }

  private applySetLiveCardCommand(
    state: GameState,
    command: SetLiveCardCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const result = this.gameService.processAction(
      state,
      createSetLiveCardAction(command.playerId, command.cardId, command.faceDown)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'SET_LIVE_CARD',
      declarationPublicValue: command.faceDown ? 'FACE_DOWN' : 'FACE_UP',
      extraPublicEvents: [
        command.faceDown
          ? buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
              from: createOwnedZoneRef(ZoneType.HAND, actorSeat),
              to: buildZoneRefForMove(
                result.gameState,
                command.playerId,
                command.cardId,
                ZoneType.LIVE_ZONE
              ),
            })
          : buildCardRevealedAndMovedPublicEvent(result.gameState, actorSeat, command.cardId, {
              from: createOwnedZoneRef(ZoneType.HAND, actorSeat),
              to: buildZoneRefForMove(
                result.gameState,
                command.playerId,
                command.cardId,
                ZoneType.LIVE_ZONE
              ),
              reason: 'SET_LIVE_CARD',
            }),
      ],
    };
  }

  private applyTapMemberCommand(
    state: GameState,
    command: TapMemberCommand
  ): CommandExecutionResult {
    const result = this.gameService.processAction(
      state,
      createTapMemberAction(command.playerId, command.cardId, command.slot)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'TAP_MEMBER',
      declarationPublicValue: command.slot,
    };
  }

  private applyTapEnergyCommand(
    state: GameState,
    command: TapEnergyCommand
  ): CommandExecutionResult {
    const result = this.gameService.processAction(
      state,
      createTapEnergyAction(command.playerId, command.cardId)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'ENERGY_STATE_TOGGLED',
      declarationPublicValue: command.cardId,
    };
  }

  private applyEndPhaseCommand(state: GameState, command: EndPhaseCommand): CommandExecutionResult {
    const result = this.gameService.processAction(state, createEndPhaseAction(command.playerId));
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'END_PHASE',
    };
  }

  private applyOpenInspectionCommand(
    initialState: GameState,
    command: OpenInspectionCommand
  ): CommandExecutionResult {
    const player = initialState.players.find((candidate) => candidate.id === command.playerId);
    if (!player) {
      return { success: false, gameState: initialState, error: '玩家不存在' };
    }

    const actorSeat = getSeatForPlayer(initialState, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: initialState, error: '玩家不存在' };
    }

    const sourceZone =
      command.sourceZone === ZoneType.ENERGY_DECK ? player.energyDeck : player.mainDeck;
    const cardIds = sourceZone.cardIds.slice(0, command.count);
    let workingState = initialState;
    const extraPublicEvents: PublicEventDraft[] = [
      {
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat,
        sourceZone: command.sourceZone,
        ownerSeat: actorSeat,
        count: cardIds.length,
      },
    ];

    for (const cardId of cardIds) {
      // Remove from source deck
      workingState = removeCardFromPlayerZone(workingState, command.playerId, cardId, command.sourceZone);
      // Add to inspection zone
      workingState = addCardToInspectionZone(workingState, cardId);

      extraPublicEvents.push(
        buildCardMovedPublicEvent(workingState, workingState, actorSeat, cardId, {
          from: createOwnedZoneRef(command.sourceZone, actorSeat),
          to: createInspectionZoneRef(actorSeat, workingState.inspectionZone.cardIds.length - 1),
        })
      );
    }

    // Set or keep inspection context (append semantics)
    if (!workingState.inspectionContext) {
      workingState = withInspectionContext(workingState, {
        ownerPlayerId: command.playerId,
        sourceZone: command.sourceZone,
      });
    }

    return {
      success: true,
      gameState: workingState,
      extraPublicEvents,
      privateEventsBySeat: {
        [actorSeat]: [
          {
            type: 'INSPECTION_CANDIDATES',
            payload: {
              sourceZone: command.sourceZone,
              cardIds: [...cardIds],
              count: cardIds.length,
            },
          },
        ],
      },
      sealedAuditRecords: [
        {
          type: 'INSPECTION_OPENED',
          actorSeat,
          payload: {
            sourceZone: command.sourceZone,
            cardIds: [...cardIds],
            count: cardIds.length,
          },
        },
      ],
    };
  }

  private applyRevealCheerCardCommand(
    state: GameState,
    command: RevealCheerCardCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const beforeOwnedResolution = new Set(getOwnedResolutionCardIds(state, command.playerId));
    const result = this.gameService.processAction(
      state,
      createPerformCheerAction(command.playerId, 1)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    const afterOwnedResolution = getOwnedResolutionCardIds(result.gameState, command.playerId);
    const revealedCardId = afterOwnedResolution.find(
      (cardId) => !beforeOwnedResolution.has(cardId)
    );
    if (!revealedCardId) {
      return {
        success: true,
        gameState: result.gameState,
        declarationType: 'CHEER_REVEALED',
        declarationPublicValue: 0,
      };
    }

    const revealedState = revealResolutionCard(result.gameState, revealedCardId);

    return {
      success: true,
      gameState: revealedState,
      declarationType: 'CHEER_REVEALED',
      declarationPublicValue: 1,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, revealedCardId, {
          from: createOwnedZoneRef(ZoneType.MAIN_DECK, actorSeat, { index: 0 }),
          to: createResolutionZoneRef(getResolutionIndex(result.gameState, revealedCardId)),
        }),
        buildCardRevealedPublicEvent(revealedState, actorSeat, revealedCardId, {
          from: createResolutionZoneRef(getResolutionIndex(revealedState, revealedCardId)),
          reason: 'CHEER_REVEAL',
        }),
      ],
      sealedAuditRecords: [
        {
          type: 'CHEER_REVEALED',
          actorSeat,
          payload: {
            cardId: revealedCardId,
            resolutionIndex: getResolutionIndex(result.gameState, revealedCardId) ?? null,
          },
        },
      ],
    };
  }

  private applyMoveInspectedCardToTopCommand(
    state: GameState,
    command: MoveInspectedCardToTopCommand
  ): CommandExecutionResult {
    const sourceZone = getInspectionSourceZone(state, command.playerId);
    if (!sourceZone) {
      return { success: false, gameState: state, error: '当前没有进行中的检视流程' };
    }

    return this.applyInspectionMoveCommand(state, command.playerId, command.cardId, sourceZone, {
      position: 'TOP',
    });
  }

  private applyMoveInspectedCardToBottomCommand(
    state: GameState,
    command: MoveInspectedCardToBottomCommand
  ): CommandExecutionResult {
    const sourceZone = getInspectionSourceZone(state, command.playerId);
    if (!sourceZone) {
      return { success: false, gameState: state, error: '当前没有进行中的检视流程' };
    }

    return this.applyInspectionMoveCommand(state, command.playerId, command.cardId, sourceZone, {
      position: 'BOTTOM',
    });
  }

  private applyMoveInspectedCardToZoneCommand(
    state: GameState,
    command: MoveInspectedCardToZoneCommand
  ): CommandExecutionResult {
    return this.applyInspectionMoveCommand(state, command.playerId, command.cardId, command.toZone);
  }

  private applyRevealInspectedCardCommand(
    state: GameState,
    command: RevealInspectedCardCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    if (state.inspectionZone.revealedCardIds.includes(command.cardId)) {
      return { success: true, gameState: state, extraPublicEvents: [] };
    }

    const inspectionIndex = state.inspectionZone.cardIds.indexOf(command.cardId);
    const nextState = revealInspectionZoneCard(state, command.cardId);

    return {
      success: true,
      gameState: nextState,
      declarationType: 'INSPECTED_CARD_REVEALED',
      declarationPublicValue: 1,
      extraPublicEvents: [
        buildCardRevealedPublicEvent(nextState, actorSeat, command.cardId, {
          from: createInspectionZoneRef(
            actorSeat,
            inspectionIndex >= 0 ? inspectionIndex : undefined
          ),
          reason: 'INSPECTION_REVEAL',
        }),
      ],
    };
  }

  private applyReorderInspectedCardCommand(
    state: GameState,
    command: ReorderInspectedCardCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const fromIndex = state.inspectionZone.cardIds.indexOf(command.cardId);
    if (fromIndex < 0) {
      return { success: false, gameState: state, error: '卡牌当前不在检视区' };
    }
    if (fromIndex === command.toIndex) {
      return { success: true, gameState: state, extraPublicEvents: [] };
    }

    const nextState = reorderInspectionZoneCard(state, command.cardId, command.toIndex);

    return {
      success: true,
      gameState: nextState,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, nextState, actorSeat, command.cardId, {
          from: createInspectionZoneRef(actorSeat, fromIndex),
          to: createInspectionZoneRef(actorSeat, command.toIndex),
        }),
      ],
    };
  }

  private applyInspectionMoveCommand(
    state: GameState,
    playerId: string,
    cardId: string,
    toZone: ZoneType,
    options?: { position?: 'TOP' | 'BOTTOM' }
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const inspectionIndex = state.inspectionZone.cardIds.indexOf(cardId);
    // Remove from inspection zone and add to target zone directly
    let workingState = removeCardFromInspectionZone(state, cardId);
    workingState = addCardToPlayerZone(workingState, playerId, cardId, toZone, options);

    return {
      success: true,
      gameState: workingState,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, workingState, actorSeat, cardId, {
          from: createInspectionZoneRef(
            actorSeat,
            inspectionIndex >= 0 ? inspectionIndex : undefined
          ),
          to: buildZoneRefForMove(workingState, playerId, cardId, toZone, options),
        }),
      ],
    };
  }

  private applyMoveResolutionCardToZoneCommand(
    state: GameState,
    command: MoveResolutionCardToZoneCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const resolutionIndex = getResolutionIndex(state, command.cardId);
    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        ZoneType.RESOLUTION_ZONE,
        command.toZone,
        {
          position: command.position,
        }
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
          from: createResolutionZoneRef(resolutionIndex),
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            command.toZone,
            {
              position: command.position,
            }
          ),
        }),
      ],
    };
  }

  private applyMoveTableCardCommand(
    state: GameState,
    command: MoveTableCardCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const card = state.cardRegistry.get(command.cardId);
    if (!card) {
      return { success: false, gameState: state, error: '卡牌不存在' };
    }

    const fromRef = buildZoneRefForMove(state, command.playerId, command.cardId, command.fromZone, {
      slot: command.sourceSlot,
    });
    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        command.fromZone,
        command.toZone,
        {
          targetSlot: command.targetSlot,
          sourceSlot: command.sourceSlot,
          position: command.position,
        }
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    const extraPublicEvents: PublicEventDraft[] = [];
    if (isZonePubliclyObservable(command.fromZone) || isZonePubliclyObservable(command.toZone)) {
      extraPublicEvents.push(
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, card.instanceId, {
          from: fromRef,
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            command.toZone,
            {
              slot: command.targetSlot,
              position: command.position,
            }
          ),
        })
      );
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'TABLE_CARD_MOVED',
      declarationPublicValue: `${command.fromZone}->${command.toZone}`,
      extraPublicEvents,
    };
  }

  private applyMoveMemberToSlotCommand(
    state: GameState,
    command: MoveMemberToSlotCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        ZoneType.MEMBER_SLOT,
        ZoneType.MEMBER_SLOT,
        {
          sourceSlot: command.sourceSlot,
          targetSlot: command.targetSlot,
        }
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'MEMBER_MOVED_TO_SLOT',
      declarationPublicValue: `${command.sourceSlot}->${command.targetSlot}`,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
          from: buildZoneRefForMove(state, command.playerId, command.cardId, ZoneType.MEMBER_SLOT, {
            slot: command.sourceSlot,
          }),
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            ZoneType.MEMBER_SLOT,
            {
              slot: command.targetSlot,
            }
          ),
        }),
      ],
    };
  }

  private applyAttachEnergyToMemberCommand(
    state: GameState,
    command: AttachEnergyToMemberCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const fromRef = buildZoneRefForMove(state, command.playerId, command.cardId, command.fromZone);
    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        command.fromZone,
        ZoneType.MEMBER_SLOT,
        {
          targetSlot: command.targetSlot,
        }
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'ENERGY_ATTACHED_TO_MEMBER',
      declarationPublicValue: command.targetSlot,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
          from: fromRef,
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            ZoneType.MEMBER_SLOT,
            {
              slot: command.targetSlot,
            }
          ),
        }),
      ],
    };
  }

  private applyPlayMemberToSlotCommand(
    state: GameState,
    command: PlayMemberToSlotCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const player = state.players.find((candidate) => candidate.id === command.playerId);
    if (!player) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const replacedCardId = player.memberSlots.slots[command.targetSlot] ?? null;
    const result = this.gameService.processAction(
      state,
      createPlayMemberAction(command.playerId, command.cardId, command.targetSlot, {
        isRelay: replacedCardId !== null,
      })
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    const extraPublicEvents: PublicEventDraft[] = [
      buildCardRevealedAndMovedPublicEvent(result.gameState, actorSeat, command.cardId, {
        from: createOwnedZoneRef(ZoneType.HAND, actorSeat),
        to: buildZoneRefForMove(
          result.gameState,
          command.playerId,
          command.cardId,
          ZoneType.MEMBER_SLOT,
          {
            slot: command.targetSlot,
          }
        ),
        reason: 'PLAY_MEMBER',
      }),
    ];

    if (replacedCardId) {
      extraPublicEvents.unshift(
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, replacedCardId, {
          from: buildZoneRefForMove(state, command.playerId, replacedCardId, ZoneType.MEMBER_SLOT, {
            slot: command.targetSlot,
          }),
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            replacedCardId,
            ZoneType.WAITING_ROOM
          ),
        })
      );
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'PLAY_MEMBER_TO_SLOT',
      declarationPublicValue: command.targetSlot,
      extraPublicEvents,
    };
  }

  private applyMovePublicCardToWaitingRoomCommand(
    state: GameState,
    command: MovePublicCardToWaitingRoomCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        command.fromZone,
        ZoneType.WAITING_ROOM,
        {
          sourceSlot: command.sourceSlot,
        }
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'MOVE_PUBLIC_CARD_TO_WAITING_ROOM',
      declarationPublicValue: command.fromZone,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
          from: buildZoneRefForMove(state, command.playerId, command.cardId, command.fromZone, {
            slot: command.sourceSlot,
          }),
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            ZoneType.WAITING_ROOM
          ),
        }),
      ],
    };
  }

  private applyMovePublicCardToHandCommand(
    state: GameState,
    command: MovePublicCardToHandCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        command.fromZone,
        ZoneType.HAND,
        {
          sourceSlot: command.sourceSlot,
        }
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'MOVE_PUBLIC_CARD_TO_HAND',
      declarationPublicValue: command.fromZone,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
          from: buildZoneRefForMove(state, command.playerId, command.cardId, command.fromZone, {
            slot: command.sourceSlot,
          }),
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            ZoneType.HAND
          ),
        }),
      ],
    };
  }

  private applyFinishInspectionCommand(
    state: GameState,
    command: FinishInspectionCommand
  ): CommandExecutionResult {
    return {
      success: true,
      gameState: withInspectionContext(state, null),
      declarationType: 'INSPECTION_FINISHED',
      declarationPublicValue: getOwnedInspectionCardIds(state, command.playerId).length,
      sealedAuditRecords: [
        {
          type: 'INSPECTION_FINISHED',
          actorSeat: getSeatForPlayer(state, command.playerId) ?? undefined,
          payload: {
            remainingCardIds: [...getOwnedInspectionCardIds(state, command.playerId)],
          },
        },
      ],
    };
  }

  private applyConfirmStepCommand(
    state: GameState,
    command: ConfirmStepCommand
  ): CommandExecutionResult {
    const result = this.gameService.processAction(
      state,
      createConfirmSubPhaseAction(command.playerId, command.subPhase)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'STEP_CONFIRMED',
      declarationPublicValue: command.subPhase,
    };
  }

  private applyConfirmPerformanceOutcomeCommand(
    initialState: GameState,
    command: ConfirmPerformanceOutcomeCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(initialState, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: initialState, error: '玩家不存在' };
    }

    const player = initialState.players.find((candidate) => candidate.id === command.playerId);
    if (!player) {
      return { success: false, gameState: initialState, error: '玩家不存在' };
    }

    let workingState = initialState;
    const extraPublicEvents: PublicEventDraft[] = [];

    if (!command.success) {
      const ownedResolutionCardIds = getOwnedResolutionCardIds(workingState, command.playerId);
      for (const cardId of ownedResolutionCardIds) {
        const resolutionIndex = getResolutionIndex(workingState, cardId);
        const moveResult = this.gameService.processAction(
          workingState,
          createManualMoveCardAction(
            command.playerId,
            cardId,
            ZoneType.RESOLUTION_ZONE,
            ZoneType.WAITING_ROOM
          )
        );
        if (!moveResult.success) {
          return { success: false, gameState: workingState, error: moveResult.error };
        }
        workingState = moveResult.gameState;
        extraPublicEvents.push(
          buildCardMovedPublicEvent(workingState, moveResult.gameState, actorSeat, cardId, {
            from: createResolutionZoneRef(resolutionIndex),
            to: buildZoneRefForMove(
              moveResult.gameState,
              command.playerId,
              cardId,
              ZoneType.WAITING_ROOM
            ),
          })
        );
      }

      const liveCardIds = [...player.liveZone.cardIds];
      for (const cardId of liveCardIds) {
        const liveIndex = getOwnedLiveIndex(workingState, command.playerId, cardId);
        const moveResult = this.gameService.processAction(
          workingState,
          createManualMoveCardAction(
            command.playerId,
            cardId,
            ZoneType.LIVE_ZONE,
            ZoneType.WAITING_ROOM
          )
        );
        if (!moveResult.success) {
          return { success: false, gameState: workingState, error: moveResult.error };
        }
        workingState = moveResult.gameState;
        extraPublicEvents.push(
          buildCardMovedPublicEvent(workingState, moveResult.gameState, actorSeat, cardId, {
            from: createOwnedZoneRef(
              ZoneType.LIVE_ZONE,
              actorSeat,
              liveIndex !== null ? { index: liveIndex } : undefined
            ),
            to: buildZoneRefForMove(
              moveResult.gameState,
              command.playerId,
              cardId,
              ZoneType.WAITING_ROOM
            ),
          })
        );
      }
    }

    const judgmentResults = new Map<string, boolean>();
    player.liveZone.cardIds.forEach((cardId) => {
      judgmentResults.set(cardId, command.success);
    });

    const judgmentResult = this.gameService.processAction(
      workingState,
      createConfirmJudgmentAction(command.playerId, judgmentResults)
    );
    if (!judgmentResult.success) {
      return { success: false, gameState: workingState, error: judgmentResult.error };
    }
    workingState = judgmentResult.gameState;

    const confirmResult = this.gameService.processAction(
      workingState,
      createConfirmSubPhaseAction(command.playerId, SubPhase.PERFORMANCE_JUDGMENT)
    );
    if (!confirmResult.success) {
      return { success: false, gameState: workingState, error: confirmResult.error };
    }

    return {
      success: true,
      gameState: confirmResult.gameState,
      declarationType: command.success ? 'PERFORMANCE_SUCCEEDED' : 'PERFORMANCE_FAILED',
      declarationPublicValue: judgmentResults.size,
      extraPublicEvents,
    };
  }

  private applyDrawCardToHandCommand(
    state: GameState,
    command: DrawCardToHandCommand
  ): CommandExecutionResult {
    const player = state.players.find((candidate) => candidate.id === command.playerId);
    if (!player) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const topCardId = player.mainDeck.cardIds[0];
    if (!topCardId) {
      return { success: false, gameState: state, error: '主卡组没有可抽取的卡牌' };
    }

    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(command.playerId, topCardId, ZoneType.MAIN_DECK, ZoneType.HAND)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'DRAW_TO_HAND',
      declarationPublicValue: 1,
      privateEventsBySeat: {
        [getSeatForPlayer(state, command.playerId) ?? 'FIRST']: [
          {
            type: 'DRAW_RESOLVED',
            payload: {
              cardIds: [topCardId],
              count: 1,
            },
          },
        ],
      },
      sealedAuditRecords: [
        {
          type: 'DRAW_RESOLVED',
          actorSeat: getSeatForPlayer(state, command.playerId) ?? undefined,
          payload: {
            cardIds: [topCardId],
            count: 1,
          },
        },
      ],
    };
  }

  private applyDrawEnergyToZoneCommand(
    state: GameState,
    command: DrawEnergyToZoneCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        ZoneType.ENERGY_DECK,
        ZoneType.ENERGY_ZONE
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'DRAW_ENERGY_TO_ZONE',
      declarationPublicValue: 1,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
          from: createOwnedZoneRef(ZoneType.ENERGY_DECK, actorSeat),
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            ZoneType.ENERGY_ZONE
          ),
        }),
      ],
    };
  }

  private applyReturnHandCardToTopCommand(
    state: GameState,
    command: ReturnHandCardToTopCommand
  ): CommandExecutionResult {
    const result = this.gameService.processAction(
      state,
      createManualMoveCardAction(
        command.playerId,
        command.cardId,
        ZoneType.HAND,
        ZoneType.MAIN_DECK,
        {
          position: 'TOP',
        }
      )
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'RETURN_HAND_CARD_TO_TOP',
      declarationPublicValue: 1,
    };
  }

  private applySubmitJudgmentCommand(
    state: GameState,
    command: SubmitJudgmentCommand
  ): CommandExecutionResult {
    const result = this.gameService.processAction(
      state,
      createConfirmJudgmentAction(command.playerId, command.judgmentResults)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'JUDGMENT_CONFIRMED',
      declarationPublicValue: command.judgmentResults.size,
    };
  }

  private applySubmitScoreCommand(
    state: GameState,
    command: SubmitScoreCommand
  ): CommandExecutionResult {
    const result = this.gameService.processAction(
      state,
      createConfirmScoreAction(command.playerId, command.adjustedScore)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    const confirmedScore = result.gameState.liveResolution.playerScores.get(command.playerId) ?? 0;
    return {
      success: true,
      gameState: result.gameState,
      declarationType: 'SCORE_SUBMITTED',
      declarationPublicValue: confirmedScore,
    };
  }

  private applySelectSuccessLiveCommand(
    state: GameState,
    command: SelectSuccessLiveCommand
  ): CommandExecutionResult {
    const actorSeat = getSeatForPlayer(state, command.playerId);
    if (!actorSeat) {
      return { success: false, gameState: state, error: '玩家不存在' };
    }

    const liveIndex = getOwnedLiveIndex(state, command.playerId, command.cardId);
    const result = this.gameService.processAction(
      state,
      createSelectSuccessCardAction(command.playerId, command.cardId)
    );
    if (!result.success) {
      return { success: false, gameState: state, error: result.error };
    }

    return {
      success: true,
      gameState: result.gameState,
      extraPublicEvents: [
        buildCardMovedPublicEvent(state, result.gameState, actorSeat, command.cardId, {
          from: createOwnedZoneRef(
            ZoneType.LIVE_ZONE,
            actorSeat,
            liveIndex !== null ? { index: liveIndex } : undefined
          ),
          to: buildZoneRefForMove(
            result.gameState,
            command.playerId,
            command.cardId,
            ZoneType.SUCCESS_ZONE
          ),
        }),
      ],
    };
  }

  /**
   * 对墙打模式：自动跳过对手阶段
   *
   * 根据刚刚执行的动作类型和当前状态，决定是否需要自动触发对手的跳过动作。
   */
  private handleSolitaireAutoSkip(lastAction: GameAction): GameState {
    if (!this.authorityState) throw new Error('Solitaire auto-skip: authorityState is null');

    const state = this.authorityState;
    const opponentId = this.getOpponentId(lastAction.playerId);
    if (!opponentId) return state;

    // 1. 玩家完成换牌 → 自动跳过对手换牌
    if (lastAction.type === 'MULLIGAN' && state.currentPhase === GamePhase.MULLIGAN_PHASE) {
      const mulliganAction = createMulliganAction(opponentId, []);
      const result = this.gameService.processAction(state, mulliganAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: mulliganAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: mulliganAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);
      }
      return this.authorityState!;
    }

    // 2. LIVE_SET_PHASE 中对手的子阶段自动跳过
    //    玩家完成盖牌后，子阶段链推进到对手的 LIVE_SET_SECOND_PLAYER，自动确认
    if (
      state.currentPhase === GamePhase.LIVE_SET_PHASE &&
      state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER
    ) {
      const confirmAction = createConfirmSubPhaseAction(
        opponentId,
        SubPhase.LIVE_SET_SECOND_PLAYER
      );
      const result = this.gameService.processAction(this.authorityState, confirmAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: confirmAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);
      }
      return this.authorityState!;
    }

    // 3. 进入 PERFORMANCE_PHASE 且活跃玩家是对手 → 自动跳过对手演出
    if (state.currentPhase === GamePhase.PERFORMANCE_PHASE && this.isActivePlayer(opponentId)) {
      return this.skipOpponentPerformance(opponentId);
    }

    // 4. 对手通常阶段自动跳过：活跃/能量/抽卡已在 autoAdvance 中处理，
    //    主要阶段需要自动 END_PHASE
    if (state.currentPhase === GamePhase.MAIN_PHASE && this.isActivePlayer(opponentId)) {
      const endAction = createEndPhaseAction(opponentId);
      const result = this.gameService.processAction(this.authorityState, endAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: endAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: endAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);
      }
      return this.authorityState!;
    }

    // 5. LIVE_RESULT_PHASE 中对手的成功效果子阶段自动跳过
    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS
    ) {
      // 对手没有成功卡，直接跳过
      const confirmAction = createConfirmSubPhaseAction(
        opponentId,
        SubPhase.RESULT_SECOND_SUCCESS_EFFECTS
      );
      const result = this.gameService.processAction(this.authorityState, confirmAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: confirmAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);

        // 紧接着若已进入 RESULT_SETTLEMENT，继续自动为对手确认分数，
        // 避免玩家下一步点"确认完成"时因为"双方未确认分数"而卡死。
        if (
          this.authorityState.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
          this.authorityState.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
          !this.authorityState.liveResolution.scoreConfirmedBy.includes(opponentId)
        ) {
          const opponentScore =
            this.authorityState.liveResolution.playerScores.get(opponentId) ?? 0;
          const confirmScoreAction = createConfirmScoreAction(opponentId, opponentScore);
          const scoreResult = this.gameService.processAction(
            this.authorityState,
            confirmScoreAction
          );
          if (scoreResult.success) {
            this.setAuthorityState(scoreResult.gameState, {
              source: 'SYSTEM',
              actorPlayerId: opponentId,
              declarationActionType: confirmScoreAction.type,
            });
            this.emitEvent({
              type: 'ACTION_EXECUTED',
              action: confirmScoreAction,
              playerId: opponentId,
            });
            this.autoAdvance(this.authorityState);
          }
        }
      }
      return this.authorityState!;
    }

    // 6. LIVE_RESULT_PHASE 的最终分数确认：自动为对手确认分数，避免墙打卡死
    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
      !state.liveResolution.scoreConfirmedBy.includes(opponentId)
    ) {
      const opponentScore = state.liveResolution.playerScores.get(opponentId) ?? 0;
      const confirmScoreAction = createConfirmScoreAction(opponentId, opponentScore);
      const result = this.gameService.processAction(this.authorityState, confirmScoreAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: confirmScoreAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmScoreAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);
      }
      return this.authorityState!;
    }

    return this.authorityState!;
  }

  private handleSolitaireAutoSkipAfterCommand(playerId: string): GameState {
    if (!this.authorityState) {
      throw new Error('Solitaire auto-skip after command: authorityState is null');
    }

    const state = this.authorityState;
    const opponentId = this.getOpponentId(playerId);
    if (!opponentId) {
      return state;
    }

    if (state.currentPhase === GamePhase.PERFORMANCE_PHASE && this.isActivePlayer(opponentId)) {
      return this.skipOpponentPerformance(opponentId);
    }

    if (state.currentPhase === GamePhase.MAIN_PHASE && this.isActivePlayer(opponentId)) {
      const endAction = createEndPhaseAction(opponentId);
      const result = this.gameService.processAction(this.authorityState, endAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: endAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: endAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);
      }
      return this.authorityState!;
    }

    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS
    ) {
      const confirmAction = createConfirmSubPhaseAction(
        opponentId,
        SubPhase.RESULT_SECOND_SUCCESS_EFFECTS
      );
      const result = this.gameService.processAction(this.authorityState, confirmAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: confirmAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);
      }
      return this.authorityState!;
    }

    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
      !state.liveResolution.scoreConfirmedBy.includes(opponentId)
    ) {
      const opponentScore = state.liveResolution.playerScores.get(opponentId) ?? 0;
      const confirmScoreAction = createConfirmScoreAction(opponentId, opponentScore);
      const result = this.gameService.processAction(this.authorityState, confirmScoreAction);
      if (result.success) {
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: confirmScoreAction.type,
        });
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmScoreAction,
          playerId: opponentId,
        });
        this.autoAdvance(this.authorityState);
      }
    }

    return this.authorityState!;
  }

  /**
   * 跳过对手的演出阶段
   *
   * 对手没有放置 Live 卡，演出阶段的翻卡/效果/判定均无实际操作。
   * 连续推进子阶段直到演出阶段结束。
   */
  private skipOpponentPerformance(opponentId: string): GameState {
    if (!this.authorityState) throw new Error('Solitaire performance skip: authorityState is null');

    let state = this.authorityState;
    const maxIterations = 10;

    for (let i = 0; i < maxIterations; i++) {
      // 不再在演出阶段或已离开演出阶段，停止
      if (state.currentPhase !== GamePhase.PERFORMANCE_PHASE) break;
      // 活跃玩家已不是对手，停止
      if (!this.isActivePlayer(opponentId)) break;

      // 根据当前子阶段决定跳过方式
      const subPhase = state.currentSubPhase;

      if (subPhase === SubPhase.PERFORMANCE_REVEAL) {
        // 翻卡子阶段：通过 advancePhase 推进
        const result = this.gameService.advancePhase(state);
        if (!result.success || !result.gameState) break;
        this.setAuthorityState(result.gameState, { source: 'SYSTEM' });
        state = this.authorityState!;
        this.emitEvent({
          type: 'PHASE_CHANGED',
          phase: state.currentPhase,
          activePlayerId: getActivePlayer(state).id,
        });
      } else if (
        subPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS ||
        subPhase === SubPhase.PERFORMANCE_JUDGMENT
      ) {
        // 效果窗口/判定子阶段：dispatch CONFIRM_SUB_PHASE 跳过
        const confirmAction = createConfirmSubPhaseAction(opponentId, subPhase);
        const result = this.gameService.processAction(state, confirmAction);
        if (!result.success) break;
        this.setAuthorityState(result.gameState, {
          source: 'SYSTEM',
          actorPlayerId: opponentId,
          declarationActionType: confirmAction.type,
        });
        state = this.authorityState!;
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmAction,
          playerId: opponentId,
        });
      } else {
        // 未知子阶段，尝试 advancePhase
        const result = this.gameService.advancePhase(state);
        if (!result.success || !result.gameState) break;
        this.setAuthorityState(result.gameState, { source: 'SYSTEM' });
        state = this.authorityState!;
        this.emitEvent({
          type: 'PHASE_CHANGED',
          phase: state.currentPhase,
          activePlayerId: getActivePlayer(state).id,
        });
      }

      // 继续自动推进（处理自动子阶段）
      state = this.autoAdvance(state);
    }

    this.setAuthorityState(state, { source: 'SYSTEM' });
    return state;
  }

  /**
   * 获取对手玩家 ID
   */
  private getOpponentId(playerId: string): string | null {
    if (!this.authorityState) return null;
    const opponent = this.authorityState.players.find((p) => p.id !== playerId);
    return opponent?.id ?? null;
  }

  /**
   * 自动推进阶段
   *
   * 循环执行自动阶段（活跃、能量、抽卡），直到进入需要玩家操作的阶段。
   * 对墙打模式下，对手的自动阶段也会被跳过。
   */
  private autoAdvance(state: GameState): GameState {
    let currentState = state;
    let iterations = 0;

    while (
      AUTO_ADVANCE_PHASES.includes(currentState.currentPhase) &&
      iterations < MAX_AUTO_ADVANCE_ITERATIONS &&
      currentState.currentPhase !== GamePhase.GAME_END
    ) {
      // 对墙打模式：如果活跃玩家是对手，仍然自动推进（活跃/能量/抽卡阶段无实际操作意义）
      // 这些阶段本身已经是 AUTO_ADVANCE 的，直接推进即可
      const prevPhase = currentState.currentPhase;
      const result = this.gameService.advancePhase(currentState);

      if (!result.success) {
        console.warn('[GameSession] 自动推进阶段失败:', result.error);
        break;
      }

      this.setAuthorityState(result.gameState, { source: 'SYSTEM' });
      currentState = this.authorityState!;
      iterations++;

      // 发送阶段变更事件
      this.emitEvent({
        type: 'PHASE_CHANGED',
        phase: currentState.currentPhase,
        activePlayerId: getActivePlayer(currentState).id,
      });

      // 检测是否发生回合切换
      if (prevPhase === GamePhase.ACTIVE_PHASE && iterations === 1) {
        this.emitEvent({
          type: 'TURN_CHANGED',
          turnNumber: currentState.turnCount,
          activePlayerId: getActivePlayer(currentState).id,
        });
      }
    }

    if (iterations >= MAX_AUTO_ADVANCE_ITERATIONS) {
      console.error('[GameSession] 自动推进阶段达到最大迭代次数，可能存在无限循环');
    }

    return currentState;
  }

  private setAuthorityState(nextState: GameState, options: StateTransitionOptions = {}): void {
    const previousState = this.authorityState;
    const normalizedState = normalizeInspectionState(nextState);
    this.authorityState = normalizedState;
    this.recordPublicStateTransition(previousState, normalizedState, options);
    this.recordPrivateStateTransition(normalizedState, options);
    this.recordSealedAuditTransition(normalizedState, options);
    this.recordAuthoritySnapshot(normalizedState);
  }

  private recordPublicStateTransition(
    previousState: GameState | null,
    nextState: GameState,
    options: StateTransitionOptions
  ): void {
    const source = options.source ?? 'SYSTEM';
    const actorSeat =
      options.actorPlayerId !== undefined
        ? getSeatForPlayer(nextState, options.actorPlayerId)
        : null;

    if (options.declarationActionType && actorSeat) {
      this.appendPublicEvent(nextState, {
        type: 'PlayerDeclared',
        source,
        actorSeat,
        declarationType: options.declarationActionType,
        publicValue: options.declarationPublicValue,
      });
    }

    for (const event of options.extraPublicEvents ?? []) {
      this.appendPublicEvent(nextState, event);
    }

    if (!previousState || previousState.currentPhase !== nextState.currentPhase) {
      this.appendPublicEvent(nextState, {
        type: 'PhaseStarted',
        source,
        actorSeat: actorSeat ?? undefined,
        phase: nextState.currentPhase,
        activeSeat: getSeatByPlayerIndex(nextState.activePlayerIndex),
      });
    }

    if (!previousState || previousState.currentSubPhase !== nextState.currentSubPhase) {
      this.appendPublicEvent(nextState, {
        type: 'SubPhaseStarted',
        source,
        actorSeat: actorSeat ?? undefined,
        subPhase: nextState.currentSubPhase,
        activeSeat: getSeatByPlayerIndex(nextState.activePlayerIndex),
      });
    }

    const previousWindowSignature = previousState
      ? getWindowSignature(buildViewWindowState(previousState))
      : 'NONE';
    const previousWindow = previousState ? buildViewWindowState(previousState) : null;
    const nextWindow = buildViewWindowState(nextState);
    const nextWindowSignature = getWindowSignature(nextWindow);

    if (!previousState || previousWindowSignature !== nextWindowSignature) {
      this.appendPublicEvent(nextState, {
        type: 'WindowStatusChanged',
        source,
        actorSeat: actorSeat ?? undefined,
        windowType: mapWindowType(nextWindow),
        status: deriveWindowStatus(previousWindow, nextWindow),
        actingSeat: nextWindow?.actingSeat ?? null,
        waitingSeats: nextWindow?.waitingForSeat ? [nextWindow.waitingForSeat] : [],
        window: nextWindow,
      });
    }

    if (source === 'SYSTEM' && previousState) {
      for (const event of buildSystemDerivedPublicEvents(previousState, nextState)) {
        this.appendPublicEvent(nextState, event);
      }
    }
  }

  private appendPublicEvent(state: GameState, event: PublicEventDraft): void {
    const seq = this.publicEventSeq + 1;
    const fullEvent: PublicEvent = {
      ...event,
      eventId: `${state.gameId}:${seq}`,
      matchId: state.gameId,
      seq,
      timestamp: Date.now(),
    };

    this.publicEvents.push(fullEvent);
    this.publicEventSeq = seq;
  }

  private appendPrivateEvent(
    state: GameState,
    relatedPublicSeq: number,
    event: PrivateEventDraft & { seat: Seat }
  ): void {
    const seq = this.privateEventSeq + 1;
    const fullEvent: PrivateEvent = {
      ...event,
      eventId: `${state.gameId}:private:${event.seat}:${seq}`,
      matchId: state.gameId,
      seq,
      timestamp: Date.now(),
      relatedPublicSeq,
    };

    this.privateEventsBySeat[event.seat].push(fullEvent);
    this.privateEventSeq = seq;
  }

  private appendSealedAuditRecord(state: GameState, record: SealedAuditRecordDraft): void {
    const seq = this.sealedAuditSeq + 1;
    const fullRecord: SealedAuditRecord = {
      ...record,
      recordId: `${state.gameId}:audit:${seq}`,
      matchId: state.gameId,
      seq,
      timestamp: Date.now(),
      relatedPublicSeq: this.publicEventSeq,
    };

    this.sealedAuditRecords.push(fullRecord);
    this.sealedAuditSeq = seq;
  }

  private recordPrivateStateTransition(state: GameState, options: StateTransitionOptions): void {
    const relatedPublicSeq = this.publicEventSeq;
    for (const [seat, events] of Object.entries(options.privateEventsBySeat ?? {}) as [
      Seat,
      readonly PrivateEventDraft[],
    ][]) {
      for (const event of events) {
        this.appendPrivateEvent(state, relatedPublicSeq, {
          ...event,
          seat,
        });
      }
    }
  }

  private recordSealedAuditTransition(state: GameState, options: StateTransitionOptions): void {
    for (const record of options.sealedAuditRecords ?? []) {
      this.appendSealedAuditRecord(state, record);
    }
  }

  private recordCommand(
    command: GameCommand,
    status: MatchCommandRecord['status'],
    error?: string
  ): void {
    if (!this.authorityState) {
      return;
    }

    const seq = this.commandSeq + 1;
    this.commandLog.push({
      recordId: `${this.authorityState.gameId}:command:${seq}`,
      matchId: this.authorityState.gameId,
      seq,
      timestamp: Date.now(),
      playerId: command.playerId,
      actorSeat: getSeatForPlayer(this.authorityState, command.playerId) ?? undefined,
      commandType: command.type,
      payload: cloneTransportableValue(command),
      idempotencyKey: command.idempotencyKey,
      status,
      resultingPublicSeq: this.publicEventSeq,
      error,
    });
    this.commandSeq = seq;
  }

  private recordAuthoritySnapshot(state: GameState): void {
    const publicSeq = this.publicEventSeq;
    this.authoritySnapshots.set(publicSeq, cloneGameState(state));
    this.snapshotHistory.push({
      matchId: state.gameId,
      publicSeq,
      createdAt: Date.now(),
    });
  }

  /**
   * 发送事件
   */
  private emitEvent(event: GameSessionEvent): void {
    if (this.options.onEvent) {
      this.options.onEvent(event);
    }
  }
}

function buildCardMovedPublicEvent(
  previousState: GameState,
  nextState: GameState,
  actorSeat: Seat | undefined,
  cardId: string,
  refs: {
    from?: PublicZoneRef;
    to?: PublicZoneRef;
    source?: PublicEventSource;
  }
): PublicEventDraft {
  return {
    type: 'CardMovedPublic',
    source: refs.source ?? 'PLAYER',
    actorSeat,
    card: buildMovedPublicCardInfo(previousState, nextState, cardId, refs),
    from: refs.from,
    to: refs.to,
  };
}

function buildPublicCardInfo(cardId: string): PublicCardInfo {
  return {
    publicObjectId: createPublicObjectId(cardId),
  };
}

function buildMovedPublicCardInfo(
  previousState: GameState,
  nextState: GameState,
  cardId: string,
  refs: {
    from?: PublicZoneRef;
    to?: PublicZoneRef;
  }
): PublicCardInfo {
  if (isPublicFrontCardAtRef(nextState, cardId, refs.to)) {
    return buildDetailedPublicCardInfo(nextState, cardId);
  }

  if (isPublicFrontCardAtRef(previousState, cardId, refs.from)) {
    return buildDetailedPublicCardInfo(previousState, cardId);
  }

  return buildPublicCardInfo(cardId);
}

function buildCardRevealedPublicEvent(
  state: GameState,
  actorSeat: Seat | undefined,
  cardId: string,
  options: {
    from?: PublicZoneRef;
    reason?: string;
    source?: PublicEventSource;
  }
): PublicEventDraft {
  return {
    type: 'CardRevealed',
    source: options.source ?? 'PLAYER',
    actorSeat,
    card: buildDetailedPublicCardInfo(state, cardId),
    from: options.from,
    reason: options.reason,
  };
}

function buildCardRevealedAndMovedPublicEvent(
  state: GameState,
  actorSeat: Seat | undefined,
  cardId: string,
  options: {
    from?: PublicZoneRef;
    to?: PublicZoneRef;
    reason?: string;
    source?: PublicEventSource;
  }
): PublicEventDraft {
  return {
    type: 'CardRevealedAndMoved',
    source: options.source ?? 'PLAYER',
    actorSeat,
    card: buildDetailedPublicCardInfo(state, cardId),
    from: options.from,
    to: options.to,
    reason: options.reason,
  };
}

function buildSystemDerivedPublicEvents(
  previousState: GameState,
  nextState: GameState
): PublicEventDraft[] {
  const events: PublicEventDraft[] = [];
  const candidateCardIds = new Set<string>([
    ...previousState.cardRegistry.keys(),
    ...nextState.cardRegistry.keys(),
  ]);
  const moveEventCardIds = new Set<string>();

  for (const cardId of candidateCardIds) {
    const previousLocation = locateCardForSystemEvent(previousState, cardId);
    const nextLocation = locateCardForSystemEvent(nextState, cardId);
    if (!previousLocation || !nextLocation) {
      continue;
    }

    if (!shouldEmitSystemMoveEvent(previousLocation, nextLocation)) {
      continue;
    }

    events.push(
      buildCardMovedPublicEvent(previousState, nextState, undefined, cardId, {
        from: sanitizeSystemZoneRef(previousLocation),
        to: sanitizeSystemZoneRef(nextLocation),
        source: 'SYSTEM',
      })
    );
    moveEventCardIds.add(cardId);
  }

  for (const player of nextState.players) {
    const previousPlayer = previousState.players.find((candidate) => candidate.id === player.id);
    if (!previousPlayer) {
      continue;
    }

    const ownerSeat = getSeatForPlayer(nextState, player.id);
    if (!ownerSeat) {
      continue;
    }

    for (const cardId of player.liveZone.cardIds) {
      if (!previousPlayer.liveZone.cardIds.includes(cardId)) {
        continue;
      }

      const previousFace = previousPlayer.liveZone.cardStates.get(cardId)?.face;
      const nextFace = player.liveZone.cardStates.get(cardId)?.face;
      if (previousFace !== FaceState.FACE_DOWN || nextFace !== FaceState.FACE_UP) {
        continue;
      }

      if (moveEventCardIds.has(cardId)) {
        continue;
      }

      events.push(
        buildCardRevealedPublicEvent(nextState, undefined, cardId, {
          from: createOwnedZoneRef(ZoneType.LIVE_ZONE, ownerSeat, {
            index: getOwnedLiveIndex(nextState, player.id, cardId) ?? undefined,
          }),
          reason: 'PERFORMANCE_REVEAL',
          source: 'SYSTEM',
        })
      );
    }
  }

  return events;
}

interface EventCardLocation {
  readonly ref: PublicZoneRef & { readonly zone: ZoneType };
  readonly isPublicObservable: boolean;
}

function createEventCardLocation(
  ref: PublicZoneRef & { readonly zone: ZoneType }
): EventCardLocation {
  return {
    ref,
    isPublicObservable: isZonePubliclyObservable(ref.zone),
  };
}

function locateCardForSystemEvent(state: GameState, cardId: string): EventCardLocation | null {
  for (const player of state.players) {
    const seat = getSeatForPlayer(state, player.id);
    if (!seat) {
      continue;
    }

    if (player.hand.cardIds.includes(cardId)) {
      return createEventCardLocation(createOwnedZoneRef(ZoneType.HAND, seat));
    }

    const mainDeckIndex = player.mainDeck.cardIds.indexOf(cardId);
    if (mainDeckIndex >= 0) {
      return createEventCardLocation(
        createOwnedZoneRef(ZoneType.MAIN_DECK, seat, mainDeckIndex === 0 ? { index: 0 } : undefined)
      );
    }

    const energyDeckIndex = player.energyDeck.cardIds.indexOf(cardId);
    if (energyDeckIndex >= 0) {
      return createEventCardLocation(
        createOwnedZoneRef(
          ZoneType.ENERGY_DECK,
          seat,
          energyDeckIndex === 0 ? { index: 0 } : undefined
        )
      );
    }

    const energyZoneIndex = player.energyZone.cardIds.indexOf(cardId);
    if (energyZoneIndex >= 0) {
      return createEventCardLocation(
        createOwnedZoneRef(ZoneType.ENERGY_ZONE, seat, { index: energyZoneIndex })
      );
    }

    const liveZoneIndex = player.liveZone.cardIds.indexOf(cardId);
    if (liveZoneIndex >= 0) {
      return createEventCardLocation(
        createOwnedZoneRef(ZoneType.LIVE_ZONE, seat, { index: liveZoneIndex })
      );
    }

    const successZoneIndex = player.successZone.cardIds.indexOf(cardId);
    if (successZoneIndex >= 0) {
      return createEventCardLocation(
        createOwnedZoneRef(ZoneType.SUCCESS_ZONE, seat, { index: successZoneIndex })
      );
    }

    const waitingRoomIndex = player.waitingRoom.cardIds.indexOf(cardId);
    if (waitingRoomIndex >= 0) {
      return createEventCardLocation(
        createOwnedZoneRef(ZoneType.WAITING_ROOM, seat, { index: waitingRoomIndex })
      );
    }

    const exileZoneIndex = player.exileZone.cardIds.indexOf(cardId);
    if (exileZoneIndex >= 0) {
      return createEventCardLocation(
        createOwnedZoneRef(ZoneType.EXILE_ZONE, seat, { index: exileZoneIndex })
      );
    }

    for (const slot of Object.values(SlotPosition)) {
      if (player.memberSlots.slots[slot] === cardId) {
        return createEventCardLocation(createOwnedZoneRef(ZoneType.MEMBER_SLOT, seat, { slot }));
      }

      const overlayIndex = player.memberSlots.energyBelow[slot].indexOf(cardId);
      if (overlayIndex >= 0) {
        return createEventCardLocation({
          zone: ZoneType.MEMBER_SLOT,
          ownerSeat: seat,
          slot,
          overlayIndex,
        });
      }
    }
  }

  const resolutionIndex = state.resolutionZone.cardIds.indexOf(cardId);
  if (resolutionIndex >= 0) {
    return createEventCardLocation(createResolutionZoneRef(resolutionIndex));
  }

  const inspectionIndex = state.inspectionZone.cardIds.indexOf(cardId);
  if (inspectionIndex >= 0) {
    const card = state.cardRegistry.get(cardId);
    const ownerSeat = card ? getSeatForPlayer(state, card.ownerId) : null;
    if (ownerSeat) {
      return createEventCardLocation(createInspectionZoneRef(ownerSeat, inspectionIndex));
    }
  }

  return null;
}

function shouldEmitSystemMoveEvent(
  previousLocation: EventCardLocation,
  nextLocation: EventCardLocation
): boolean {
  if (areZoneRefsEqual(previousLocation.ref, nextLocation.ref)) {
    return false;
  }

  return previousLocation.isPublicObservable || nextLocation.isPublicObservable;
}

function sanitizeSystemZoneRef(location: EventCardLocation): PublicZoneRef {
  if (location.isPublicObservable) {
    return location.ref;
  }

  return {
    zone: location.ref.zone,
    ownerSeat: location.ref.ownerSeat,
    index: location.ref.index === 0 ? 0 : undefined,
  };
}

function areZoneRefsEqual(left: PublicZoneRef, right: PublicZoneRef): boolean {
  return (
    left.zone === right.zone &&
    left.ownerSeat === right.ownerSeat &&
    left.slot === right.slot &&
    left.index === right.index &&
    left.overlayIndex === right.overlayIndex
  );
}

function mapWindowType(window: ReturnType<typeof buildViewWindowState>): PublicWindowType | null {
  if (!window) {
    return null;
  }

  switch (window.type) {
    case 'INSPECTION':
      return 'INSPECTION';
    case 'EFFECT':
    case 'JUDGMENT':
      return 'SERIAL_PRIORITY';
    case 'MULLIGAN':
    case 'RESULT':
      return 'SIMULTANEOUS_COMMIT';
    case 'LIVE_SET':
    case 'INPUT':
    case 'NONE':
    default:
      return 'SHARED_CONFIRM';
  }
}

function deriveWindowStatus(
  previousWindow: ReturnType<typeof buildViewWindowState>,
  nextWindow: ReturnType<typeof buildViewWindowState>
): WindowStatus {
  if (!previousWindow && nextWindow) {
    return 'OPENED';
  }

  if (previousWindow && !nextWindow) {
    return 'CLOSED';
  }

  if (!previousWindow && !nextWindow) {
    return 'CLOSED';
  }

  return 'UPDATED';
}

function buildDetailedPublicCardInfo(state: GameState, cardId: string): PublicCardInfo {
  const card = state.cardRegistry.get(cardId);
  return {
    publicObjectId: createPublicObjectId(cardId),
    cardCode: card?.data.cardCode,
    name: card?.data.name,
    cardType: card?.data.cardType,
  };
}

function createInspectionZoneRef(ownerSeat: Seat, index?: number): PublicZoneRef & { readonly zone: ZoneType.INSPECTION_ZONE } {
  return {
    zone: ZoneType.INSPECTION_ZONE,
    ownerSeat,
    index,
  };
}

function createResolutionZoneRef(
  index?: number
): PublicZoneRef & { readonly zone: ZoneType.RESOLUTION_ZONE } {
  return {
    zone: ZoneType.RESOLUTION_ZONE,
    index,
  };
}

function createOwnedZoneRef(
  zone: ZoneType,
  ownerSeat: Seat,
  options?: {
    index?: number;
    slot?: string;
    overlayIndex?: number;
    position?: 'TOP' | 'BOTTOM';
  }
): PublicZoneRef & { readonly zone: ZoneType } {
  if (options?.position === 'TOP') {
    return { zone, ownerSeat, index: 0, slot: options.slot, overlayIndex: options.overlayIndex };
  }

  if (options?.position === 'BOTTOM') {
    return { zone, ownerSeat, slot: options.slot, overlayIndex: options.overlayIndex };
  }

  return {
    zone,
    ownerSeat,
    index: options?.index,
    slot: options?.slot,
    overlayIndex: options?.overlayIndex,
  };
}

function withInspectionContext(
  state: GameState,
  inspectionContext: InspectionContextState | null
): GameState {
  return {
    ...state,
    inspectionContext,
  };
}

function normalizeInspectionState(state: GameState): GameState {
  if (!state.inspectionContext) {
    return state;
  }

  if (
    state.currentPhase === GamePhase.PERFORMANCE_PHASE ||
    state.currentPhase === GamePhase.LIVE_RESULT_PHASE
  ) {
    return withInspectionContext(state, null);
  }

  return state;
}

function getInspectionSourceZone(
  state: GameState,
  playerId: string
): ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK | null {
  if (!state.inspectionContext || state.inspectionContext.ownerPlayerId !== playerId) {
    return null;
  }

  return state.inspectionContext.sourceZone;
}

function getOwnedInspectionCardIds(state: GameState, playerId: string): readonly string[] {
  return state.inspectionZone.cardIds.filter(
    (cardId) => state.cardRegistry.get(cardId)?.ownerId === playerId
  );
}

function getOwnedResolutionCardIds(state: GameState, playerId: string): readonly string[] {
  return state.resolutionZone.cardIds.filter(
    (cardId) => state.cardRegistry.get(cardId)?.ownerId === playerId
  );
}

function getOwnedLiveIndex(state: GameState, playerId: string, cardId: string): number | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return null;
  }

  const index = player.liveZone.cardIds.indexOf(cardId);
  return index >= 0 ? index : null;
}

function getResolutionIndex(state: GameState, cardId: string): number | undefined {
  const index = state.resolutionZone.cardIds.indexOf(cardId);
  return index >= 0 ? index : undefined;
}

function revealResolutionCard(state: GameState, cardId: string): GameState {
  if (!state.resolutionZone.cardIds.includes(cardId)) {
    return state;
  }

  if (state.resolutionZone.revealedCardIds.includes(cardId)) {
    return state;
  }

  return {
    ...state,
    resolutionZone: {
      ...state.resolutionZone,
      revealedCardIds: [...state.resolutionZone.revealedCardIds, cardId],
    },
  };
}

function isCardInOwnedZone(
  state: GameState,
  playerId: string,
  zone: ZoneType,
  cardId: string,
  slot?: SlotPosition
): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  switch (zone) {
    case ZoneType.HAND:
      return player.hand.cardIds.includes(cardId);
    case ZoneType.MAIN_DECK:
      return player.mainDeck.cardIds.includes(cardId);
    case ZoneType.ENERGY_DECK:
      return player.energyDeck.cardIds.includes(cardId);
    case ZoneType.ENERGY_ZONE:
      return player.energyZone.cardIds.includes(cardId);
    case ZoneType.LIVE_ZONE:
      return player.liveZone.cardIds.includes(cardId);
    case ZoneType.SUCCESS_ZONE:
      return player.successZone.cardIds.includes(cardId);
    case ZoneType.WAITING_ROOM:
      return player.waitingRoom.cardIds.includes(cardId);
    case ZoneType.EXILE_ZONE:
      return player.exileZone.cardIds.includes(cardId);
    case ZoneType.RESOLUTION_ZONE:
      return (
        state.resolutionZone.cardIds.includes(cardId) &&
        state.cardRegistry.get(cardId)?.ownerId === playerId
      );
    case ZoneType.MEMBER_SLOT: {
      if (slot) {
        return (
          player.memberSlots.slots[slot] === cardId ||
          player.memberSlots.energyBelow[slot].includes(cardId)
        );
      }

      return Object.values(SlotPosition).some(
        (currentSlot) =>
          player.memberSlots.slots[currentSlot] === cardId ||
          player.memberSlots.energyBelow[currentSlot].includes(cardId)
      );
    }
    default:
      return false;
  }
}

function isPublicFrontCardAtRef(state: GameState, cardId: string, ref?: PublicZoneRef): boolean {
  if (!ref) {
    return false;
  }

  const currentLocation = locateCardForSystemEvent(state, cardId);
  if (!currentLocation || !matchesZoneRef(currentLocation.ref, ref)) {
    return false;
  }

  return isZoneCardPublicFront({
    zone: currentLocation.ref.zone,
    liveFaceState:
      currentLocation.ref.zone === ZoneType.LIVE_ZONE
        ? getLiveCardFaceState(state, cardId)
        : undefined,
    isResolutionCardRevealed:
      currentLocation.ref.zone === ZoneType.RESOLUTION_ZONE &&
      state.resolutionZone.revealedCardIds.includes(cardId),
    isInspectionCardRevealed:
      currentLocation.ref.zone === ZoneType.INSPECTION_ZONE &&
      state.inspectionZone.revealedCardIds.includes(cardId),
  });
}

function matchesZoneRef(actual: PublicZoneRef, expected: PublicZoneRef): boolean {
  return (
    actual.zone === expected.zone &&
    (expected.ownerSeat === undefined || actual.ownerSeat === expected.ownerSeat) &&
    (expected.slot === undefined || actual.slot === expected.slot) &&
    (expected.index === undefined || actual.index === expected.index) &&
    (expected.overlayIndex === undefined || actual.overlayIndex === expected.overlayIndex)
  );
}

function getLiveCardFaceState(state: GameState, cardId: string): FaceState | undefined {
  for (const player of state.players) {
    if (!player.liveZone.cardIds.includes(cardId)) {
      continue;
    }

    return player.liveZone.cardStates.get(cardId)?.face;
  }

  return undefined;
}

function buildZoneRefForMove(
  state: GameState,
  playerId: string,
  cardId: string,
  zone: ZoneType,
  options?: {
    slot?: SlotPosition;
    position?: 'TOP' | 'BOTTOM';
  }
): PublicZoneRef {
  const ownerSeat = getSeatForPlayer(state, playerId) ?? 'FIRST';

  if (zone === ZoneType.RESOLUTION_ZONE) {
    return createResolutionZoneRef(getResolutionIndex(state, cardId));
  }

  if (zone === ZoneType.MEMBER_SLOT) {
    return findOwnedMemberZoneRef(state, playerId, cardId, ownerSeat, options?.slot);
  }

  if (
    zone === ZoneType.HAND ||
    zone === ZoneType.MAIN_DECK ||
    zone === ZoneType.ENERGY_DECK ||
    zone === ZoneType.ENERGY_ZONE ||
    zone === ZoneType.LIVE_ZONE ||
    zone === ZoneType.SUCCESS_ZONE ||
    zone === ZoneType.WAITING_ROOM ||
    zone === ZoneType.EXILE_ZONE
  ) {
    const zoneIndex = getOwnedZoneIndex(state, playerId, zone, cardId);
    return createOwnedZoneRef(zone, ownerSeat, {
      index: isZonePubliclyObservable(zone) ? zoneIndex : undefined,
      position: options?.position,
    });
  }

  return createOwnedZoneRef(zone, ownerSeat);
}

function findOwnedMemberZoneRef(
  state: GameState,
  playerId: string,
  cardId: string,
  ownerSeat: Seat,
  preferredSlot?: SlotPosition
): PublicZoneRef {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return createOwnedZoneRef(
      ZoneType.MEMBER_SLOT,
      ownerSeat,
      preferredSlot ? { slot: preferredSlot } : undefined
    );
  }

  const orderedSlots = preferredSlot
    ? [preferredSlot, ...Object.values(SlotPosition).filter((slot) => slot !== preferredSlot)]
    : Object.values(SlotPosition);

  for (const slot of orderedSlots) {
    if (player.memberSlots.slots[slot] === cardId) {
      return createOwnedZoneRef(ZoneType.MEMBER_SLOT, ownerSeat, { slot });
    }

    const overlayIndex = player.memberSlots.energyBelow[slot].indexOf(cardId);
    if (overlayIndex >= 0) {
      return createOwnedZoneRef(ZoneType.MEMBER_SLOT, ownerSeat, { slot, overlayIndex });
    }
  }

  return createOwnedZoneRef(
    ZoneType.MEMBER_SLOT,
    ownerSeat,
    preferredSlot ? { slot: preferredSlot } : undefined
  );
}

function getOwnedZoneIndex(
  state: GameState,
  playerId: string,
  zone: ZoneType,
  cardId: string
): number | undefined {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return undefined;
  }

  let index = -1;
  switch (zone) {
    case ZoneType.ENERGY_ZONE:
      index = player.energyZone.cardIds.indexOf(cardId);
      break;
    case ZoneType.LIVE_ZONE:
      index = player.liveZone.cardIds.indexOf(cardId);
      break;
    case ZoneType.SUCCESS_ZONE:
      index = player.successZone.cardIds.indexOf(cardId);
      break;
    case ZoneType.WAITING_ROOM:
      index = player.waitingRoom.cardIds.indexOf(cardId);
      break;
    case ZoneType.EXILE_ZONE:
      index = player.exileZone.cardIds.indexOf(cardId);
      break;
    default:
      return undefined;
  }

  return index >= 0 ? index : undefined;
}

function reorderOwnedResolutionCard(
  state: GameState,
  _playerId: string,
  cardId: string,
  toIndex: number
): GameState {
  return reorderInspectionZoneCard(state, cardId, toIndex);
}

function createPlayerCompatibilityGameState(state: GameState, viewerPlayerId: string): GameState {
  const viewer = state.players.find((player) => player.id === viewerPlayerId);
  if (!viewer) {
    return state;
  }

  const visibleCardIds = collectVisibleCardIdsForPlayer(state, viewerPlayerId);

  return {
    ...state,
    players: state.players.map((player) => createCompatiblePlayerState(player, viewerPlayerId)) as [
      PlayerState,
      PlayerState,
    ],
    cardRegistry: new Map(
      Array.from(state.cardRegistry.entries()).filter(([cardId]) => visibleCardIds.has(cardId))
    ),
    availableAbilityIds: [],
    operationHistory: [],
    resolutionZone: {
      ...state.resolutionZone,
      cardIds: state.resolutionZone.cardIds.filter((cardId) => visibleCardIds.has(cardId)),
      revealedCardIds: state.resolutionZone.revealedCardIds.filter((cardId) =>
        visibleCardIds.has(cardId)
      ),
    },
    liveResolution: {
      ...state.liveResolution,
      firstPlayerCheerCardIds: state.liveResolution.firstPlayerCheerCardIds.filter((cardId) =>
        visibleCardIds.has(cardId)
      ),
      secondPlayerCheerCardIds: state.liveResolution.secondPlayerCheerCardIds.filter((cardId) =>
        visibleCardIds.has(cardId)
      ),
      liveResults: new Map(
        Array.from(state.liveResolution.liveResults.entries()).filter(([cardId]) =>
          visibleCardIds.has(cardId)
        )
      ),
    },
    actionHistory: [],
  };
}

function collectVisibleCardIdsForPlayer(state: GameState, viewerPlayerId: string): Set<string> {
  const visibleCardIds = new Set<string>();
  const viewer = state.players.find((player) => player.id === viewerPlayerId);
  if (viewer) {
    addAllPlayerCardIds(viewer, visibleCardIds);
  }

  const playerView = projectPlayerViewState(state, viewerPlayerId);
  for (const publicObjectId of Object.keys(playerView.objects)) {
    visibleCardIds.add(stripPublicObjectId(publicObjectId));
  }

  return visibleCardIds;
}

function addAllPlayerCardIds(player: PlayerState, visibleCardIds: Set<string>): void {
  for (const cardId of player.hand.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const cardId of player.mainDeck.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const cardId of player.energyDeck.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const cardId of player.energyZone.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const cardId of player.liveZone.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const cardId of player.successZone.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const cardId of player.waitingRoom.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const cardId of player.exileZone.cardIds) {
    visibleCardIds.add(cardId);
  }
  for (const slot of Object.values(SlotPosition)) {
    const occupantId = player.memberSlots.slots[slot];
    if (occupantId) {
      visibleCardIds.add(occupantId);
    }
    for (const cardId of player.memberSlots.energyBelow[slot]) {
      visibleCardIds.add(cardId);
    }
  }
}

function createCompatiblePlayerState(player: PlayerState, viewerPlayerId: string): PlayerState {
  if (player.id === viewerPlayerId) {
    return player;
  }

  return {
    ...player,
    hand: maskHiddenZone(player.hand, 'HAND'),
    mainDeck: maskHiddenZone(player.mainDeck, 'MAIN_DECK'),
    energyDeck: maskHiddenZone(player.energyDeck, 'ENERGY_DECK'),
    movedToStageThisTurn: [],
    pendingAutoAbilities: [],
  };
}

function maskHiddenZone(zone: BaseZoneState, zoneLabel: string): BaseZoneState {
  return {
    ...zone,
    cardIds: zone.cardIds.map((_, index) => `hidden:${zone.playerId}:${zoneLabel}:${index}`),
  };
}

function stripPublicObjectId(publicObjectId: string): string {
  return publicObjectId.startsWith('obj_') ? publicObjectId.slice(4) : publicObjectId;
}

function buildLegacyActionPrivateEvents(
  state: GameState,
  action: GameAction
): Partial<Record<Seat, readonly PrivateEventDraft[]>> | undefined {
  const actorSeat = getSeatForPlayer(state, action.playerId);
  if (!actorSeat) {
    return undefined;
  }

  if (action.type === GameActionType.MULLIGAN) {
    return {
      [actorSeat]: [
        {
          type: 'MULLIGAN_RESOLVED',
          payload: {
            returnedCardIds: [...action.cardIdsToMulligan],
            handCardIds: [...getPlayerHandCardIds(state, action.playerId)],
          },
        },
      ],
    };
  }

  return undefined;
}

function buildLegacyActionAuditRecords(
  state: GameState,
  action: GameAction
): readonly SealedAuditRecordDraft[] {
  const actorSeat = getSeatForPlayer(state, action.playerId) ?? undefined;
  if (action.type === GameActionType.MULLIGAN) {
    return [
      {
        type: 'MULLIGAN_RESOLVED',
        actorSeat,
        payload: {
          returnedCardIds: [...action.cardIdsToMulligan],
          handCardIds: [...getPlayerHandCardIds(state, action.playerId)],
        },
      },
    ];
  }

  return [
    {
      type: 'LEGACY_ACTION_APPLIED',
      actorSeat,
      payload: {
        actionType: action.type,
        playerId: action.playerId,
      },
    },
  ];
}

function getPlayerHandCardIds(state: GameState, playerId: string): readonly string[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return player?.hand.cardIds ?? [];
}

function cloneGameState(state: GameState): GameState {
  return fromTransport<GameState>(toTransport(state));
}

function cloneTransportableValue<T>(value: T): T {
  return fromTransport<T>(toTransport(value));
}

function createComparableCommandPayload(value: unknown): unknown {
  const clonedValue = cloneTransportableValue(value);
  if (!clonedValue || typeof clonedValue !== 'object' || Array.isArray(clonedValue)) {
    return clonedValue;
  }

  const commandPayload = clonedValue as Record<string, unknown>;
  const {
    timestamp: _timestamp,
    idempotencyKey: _idempotencyKey,
    ...comparablePayload
  } = commandPayload;
  return comparablePayload;
}

function areTransportValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(toTransport(left)) === JSON.stringify(toTransport(right));
}

/**
 * 创建游戏会话
 */
export function createGameSession(options?: GameSessionOptions): GameSession {
  return new GameSession(options);
}
