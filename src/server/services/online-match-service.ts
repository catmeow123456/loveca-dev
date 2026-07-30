import { randomUUID } from 'node:crypto';
import {
  createGameSession,
  type GameSession,
  type GameSessionRuntimeStats,
} from '../../application/game-session.js';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmStepCommand,
  createEndPhaseCommand,
  createSystemConcedeCommand,
  GameCommandType,
  type GameCommand,
} from '../../application/game-commands.js';
import type {
  AiDecisionContract,
  AiDecisionSelection,
} from '../../application/ai-decisions/index.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { AnyCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import type {
  MatchRecordCompleteness,
  MatchRecordStatus,
  MatchAutomationGameMode,
  MatchDeckSnapshotSource,
  MatchMode,
  MatchOriginKind,
  MatchParticipantKind,
  OnlineAdminMatchSummary,
  OnlineCommandResult,
  OnlineMatchChatMessage,
  OnlineMatchChatMessagesResponse,
  OnlineMatchSystemNoticeCode,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  OnlineSpectatorJoinView,
  OnlineSpectatorLinkView,
  OnlineSpectatorMatchSnapshot,
  OnlineSpectatorPresenceView,
  OnlineSpectatorSessionView,
  OnlineSpectatorSnapshotResponse,
  OnlineSpectatorSwitchView,
  OnlineSpectatorWaitingView,
  OnlineUndoView,
  ManualOperationModeView,
  PublicEvent,
  PublicEventsResponse,
  RuntimeRecoveryInfo,
  Seat,
  SendOnlineMatchChatMessageInput,
  UndoEntrySummary,
  UndoPolicy,
  UndoRuntimeCaptureCursor,
} from '../../online/index.js';
import { GameEndReason, GameMode, GamePhase, SubPhase } from '../../shared/types/enums.js';
import type { ManualOperationMode } from '../../shared/types/manual-operation-mode.js';
import { applyAuthoritativeManualOperationModeToCommand } from '../../application/manual-operation-mode.js';
import {
  buildMatchRecorderBeginInputFromOnlineMatch,
  matchRecorderService,
  type MatchRecorderService,
  type MatchDecisionRecordInput,
  type AppendMatchRecordFrameInput,
} from './match-recorder-service.js';
import { rankedRatingService } from './ranked-rating-service.js';
import { buildMatchDecisionRecordsForCommand } from './match-decision-records.js';
import {
  appendOnlineMatchChatMessage,
  appendOnlineMatchSystemNotice,
  createOnlineMatchChatRuntime,
  readOnlineMatchChatBlockedTerms,
  readOnlineMatchChatMessages,
  type OnlineMatchChatRuntimeState,
} from './online-match-chat-runtime.js';
import { selectConservativeDecision } from '../ai-battle/conservative-decision-policy.js';
import { buildAiObservation, type AiObservation } from '../ai-battle/ai-observation.js';
import { selectExplainableDecision } from '../ai-battle/explainable-decision-policy.js';
import {
  AI_MODEL_DECISION_POLICY_VERSION,
  createAiModelInvocationRuntime,
  type AiModelInvocationAttemptAudit,
  type AiModelInvocationAudit,
  type AiModelInvocationRuntime,
} from '../ai-battle/model-governance.js';
import { createConfiguredAiBattleModelProvider } from '../ai-battle/model-provider.js';
import {
  buildAiModelRequestEnvelope,
  parseAiModelDecisionOutput,
  type AiModelRepairFailureCode,
  type AiModelTransportRetryFailureCode,
} from '../ai-battle/model-protocol.js';
import { buildAiStrategyContext, type AiStrategyContext } from '../ai-battle/strategy-context.js';
import {
  createAiStrategyDecisionAudit,
  createAiStrategyDecisionRecord,
  type AuditableAiDecisionResult,
  type AiStrategyDecisionAudit,
  type AiStrategyDecisionRecord,
} from '../ai-battle/strategy-decision-audit.js';
import {
  createAiSelectedHistoryTracker,
  type AiSelectedHistoryTracker,
} from '../ai-battle/strategy-history.js';
import {
  isCertifiedAiSystemParticipantBinding,
  type AiSystemParticipantBinding,
} from '../ai-battle/system-participant.js';
import {
  SingleMatchSerialExecutor,
  type SingleMatchCriticalSection,
} from '../ai-battle/single-match-serial-executor.js';
import {
  MachineDecisionCoordinator,
  type AcquireMachineDecisionLeaseResult,
  type MachineAuthoritySnapshot,
  type MachineCommandExecutionResult,
  type MachineDecisionCoordinatorOptions,
  type SubmitMachineDecisionResult,
} from '../ai-battle/machine-decision-coordinator.js';
import {
  MachineDecisionScheduler,
  type MachineDecisionScheduleFailureReason,
  type MachineDecisionSchedulerOptions,
  type MachineDecisionScheduleRegistration,
  type MachineDecisionScheduleResult,
} from '../ai-battle/machine-decision-scheduler.js';
import {
  createMachineLivenessState,
  DEFAULT_MACHINE_LIVENESS_LIMITS,
  recordMachineLivenessDecision,
  type MachineLivenessLimits,
  type MachineLivenessState,
  type MachineStrategyMode,
} from '../ai-battle/rule-progress.js';
import {
  readServerDeadlineDescriptor,
  ServerDeadlineOwner,
  type ServerDeadlineOwnerOptions,
  type ServerDeadlineRegistration,
} from '../ai-battle/server-deadline-owner.js';

const MATCH_STALE_TTL_MS = 30 * 60 * 1000;
const UNDO_REQUEST_TTL_MS = 60 * 1000;
const MANUAL_OPERATION_MODE_REQUEST_TTL_MS = 60 * 1000;
const SPECTATOR_LINK_TTL_MS = 12 * 60 * 60 * 1000;
const SPECTATOR_SESSION_STALE_MS = 15 * 1000;
const SPECTATOR_TOMBSTONE_TTL_MS = 5 * 60 * 1000;
const SPECTATOR_WAITING_RETRY_AFTER_MS = 800;
const DEFAULT_SPECTATOR_MAX_PUBLIC_SESSIONS = 10;
const DEFAULT_SPECTATOR_REQUEST_WINDOW_MS = 10 * 1000;
const DEFAULT_SPECTATOR_REQUEST_LIMIT = 60;
const DEFAULT_AUTHORITY_CHECKPOINT_INTERVAL_FRAMES = 5;
export const PUBLIC_EVENTS_RESPONSE_MAX = readPositiveIntEnv('ONLINE_PUBLIC_EVENTS_MAX_BATCH', 500);

export interface OnlineMatchParticipant {
  readonly userId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: Seat;
  readonly participantKind: MatchParticipantKind;
  readonly ownerUserId: string | null;
}

export interface CreateOnlineMatchPlayerParams {
  readonly userId: string;
  readonly displayName: string;
  readonly deck: DeckConfig;
  readonly deckId?: string | null;
  readonly deckName?: string | null;
  readonly deckSource?: MatchDeckSnapshotSource;
  readonly lockedAt?: number | null;
  readonly participantKind?: MatchParticipantKind;
  readonly ownerUserId?: string | null;
  readonly systemParticipantBinding?: AiSystemParticipantBinding | null;
}

export interface CreateOnlineMatchParams {
  readonly roomCode: string;
  readonly matchMode?: MatchMode;
  readonly automationGameMode?: MatchAutomationGameMode;
  readonly originKind?: MatchOriginKind;
  readonly originLabel?: string;
  readonly startedAt?: number;
  readonly first: CreateOnlineMatchPlayerParams;
  readonly second: CreateOnlineMatchPlayerParams;
}

export interface OnlineMatchDeckSnapshot {
  readonly seat: Seat;
  readonly userId: string;
  readonly sourceDeckId: string | null;
  readonly sourceDeckName: string | null;
  readonly source: MatchDeckSnapshotSource;
  readonly mainDeck: readonly AnyCardData[];
  readonly energyDeck: readonly AnyCardData[];
  readonly lockedAt: number | null;
}

export interface OnlineMatchState {
  readonly matchId: string;
  readonly roomCode: string;
  readonly matchMode: MatchMode;
  readonly automationGameMode: MatchAutomationGameMode;
  readonly originKind: MatchOriginKind;
  readonly originLabel: string;
  readonly session: GameSession;
  readonly participants: Readonly<Record<Seat, OnlineMatchParticipant>>;
  readonly deckSnapshots: Readonly<Record<Seat, OnlineMatchDeckSnapshot>>;
  readonly systemParticipantBindings: Readonly<Partial<Record<Seat, AiSystemParticipantBinding>>>;
  readonly startedAt: number;
  remoteRevision: number;
  recordBranchId: string;
  recordCaptureCursor: UndoRuntimeCaptureCursor;
  pendingUndoRequest: OnlineUndoRequestState | null;
  pendingManualOperationModeRequest?: OnlineManualOperationModeRequestState | null;
  activeUndoGrant: OnlineUndoGrantState | null;
  machineLiveness: MachineLivenessState | null;
  readonly appliedUndoKeys: Set<string>;
  appliedManualOperationKeys?: Map<string, string>;
  recoveryNotice:
    | (RuntimeRecoveryInfo & {
        readonly publicEvents: readonly PublicEvent[];
        readonly truncated: boolean;
        readonly droppedEventCount: number;
      })
    | null;
  readonly chat: OnlineMatchChatRuntimeState;
  updatedAt: number;
  lastActivityAt: number;
}

export interface OnlineMatchCleanupSummary {
  readonly checkedMatchCount: number;
  readonly staleMatchCount: number;
  readonly deletedMatchCount: number;
  readonly failedDeleteCount: number;
}

export interface OnlineMatchRuntimeStats {
  readonly now: number;
  readonly matchCount: number;
  readonly matchCountByMode: Readonly<Record<MatchMode, number>>;
  readonly staleMatchCount: number;
  readonly oldestLastActivityAgeMs: number | null;
  readonly spectatorLinkCount: number;
  readonly spectatorSessionCount: number;
  readonly maxSessionStats: {
    readonly matchId: string;
    readonly matchMode: MatchMode;
    readonly lastActivityAgeMs: number;
    readonly session: GameSessionRuntimeStats;
  } | null;
}

export interface RemoteUndoInput {
  readonly expectedRevision: number;
  readonly undoEntryId: string;
  readonly idempotencyKey?: string | null;
}

interface OnlineUndoRequestState {
  readonly requestId: string;
  readonly requesterSeat: Seat;
  readonly responderSeat: Seat;
  readonly requesterUserId: string;
  readonly responderUserId: string;
  readonly targetUndoEntryId: string;
  readonly targetRevision: number;
  readonly summary: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly idempotencyKey: string | null;
}

export interface OnlineManualOperationModeRequestState {
  readonly requestId: string;
  readonly requesterSeat: Seat;
  readonly responderSeat: Seat;
  readonly requesterUserId: string;
  readonly responderUserId: string;
  readonly targetMode: 'FREE';
  readonly targetRevision: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly idempotencyKey: string | null;
}

interface OnlineUndoGrantState {
  readonly grantId: string;
  readonly requesterSeat: Seat;
  readonly requesterUserId: string;
  readonly grantorSeat: Seat;
  readonly grantorUserId: string;
  readonly boundaryKey: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface OnlineSpectatorLinkState {
  readonly token: string;
  matchId: string | null;
  readonly roomCode: string;
  readonly roomGeneration: string | null;
  attachmentGeneration: number;
  readonly viewType: 'PLAYER';
  viewerSeat: Seat | null;
  readonly authorizedViewerSeats: Set<Seat>;
  readonly knownRoomMemberUserIds: Set<string>;
  readonly authorizedViewerUserIds: Set<string>;
  readonly preferredViewerUserId: string | null;
  preferredViewerDisplayName: string | null;
  readonly source: 'ADMIN_LINK' | 'ROOM_CODE';
  readonly countsInPresence: boolean;
  readonly createdAt: number;
  readonly expiresAt: number;
  revokedAt: number | null;
  revokedReason: 'ROOM_CODE_AUTHORIZATION_CLOSED' | 'ROOM_CLOSED' | 'ROOM_REPLACED' | null;
}

interface OnlineSpectatorSessionState {
  readonly sessionId: string;
  readonly token: string;
  readonly clientId: string | null;
  matchId: string | null;
  readonly roomCode: string;
  readonly roomGeneration: string | null;
  attachmentGeneration: number;
  previousMatchId: string | null;
  readonly viewType: 'PLAYER';
  viewerSeat: Seat | null;
  readonly authorizedViewerSeats: Set<Seat>;
  readonly authorizedViewerUserIds: Set<string>;
  preferredViewerUserId: string | null;
  preferredViewerDisplayName: string | null;
  effectiveViewerUserId: string | null;
  effectiveViewerDisplayName: string | null;
  viewVersion: number;
  authorizationNotice: OnlineSpectatorMatchSnapshot['spectatorView']['authorizationNotice'];
  readonly countsInPresence: boolean;
  readonly joinedAt: number;
  displayName: string;
  lastSeenAt: number;
  endedAt: number | null;
  endReason: 'ROOM_CLOSED' | 'ROOM_REPLACED' | 'AUTHORIZATION_CLOSED' | 'SESSION_EXPIRED' | null;
}

export interface CreateUndoRequestInput extends RemoteUndoInput {}

export interface RespondUndoRequestInput {
  readonly expectedRevision: number;
  readonly idempotencyKey?: string | null;
  readonly grantContinuous?: boolean;
}

export interface ChangeManualOperationModeInput {
  readonly targetMode: ManualOperationMode;
  readonly expectedRevision: number;
  readonly idempotencyKey?: string | null;
}

export interface RespondManualOperationModeRequestInput {
  readonly expectedRevision: number;
  readonly idempotencyKey?: string | null;
}

export interface OnlineMatchServiceDeps {
  readonly now?: () => number;
  readonly idGenerator?: () => string;
  readonly recorder?: Pick<
    MatchRecorderService,
    | 'beginMatch'
    | 'recordInitialCheckpoint'
    | 'markPartial'
    | 'sealMatch'
    | 'getRecordCursor'
    | 'appendMatchRecordFrame'
  > | null;
  readonly spectatorMaxPublicSessions?: number;
  readonly spectatorRequestWindowMs?: number;
  readonly spectatorRequestLimit?: number;
  readonly chatBlockedTerms?: readonly string[];
  readonly serialExecutor?: SingleMatchSerialExecutor;
  readonly deadlineRuntimeEpoch?: string;
  readonly deadlineIdGenerator?: () => string;
  readonly deadlineRetryDelayMs?: number;
  readonly deadlineScheduleTimer?: ServerDeadlineOwnerOptions['scheduleTimer'];
  readonly deadlineCancelTimer?: ServerDeadlineOwnerOptions['cancelTimer'];
  /**
   * Controlled Phase 1B runtime hook. Product entry points remain disabled
   * until the formal SYSTEM participant phase.
   */
  readonly machineDecisionSchedulingEnabled?: boolean;
  readonly machineDecisionRuntimeEpoch?: string;
  readonly machineDecisionIdGenerator?: () => string;
  readonly machineDecisionLeaseTtlMs?: number;
  readonly machineDecisionSchedulerRuntimeEpoch?: string;
  readonly machineDecisionSchedulerIdGenerator?: () => string;
  readonly machineDecisionSchedulerRetryDelayMs?: number;
  readonly machineDecisionSchedulerMaxCallbackFailures?: number;
  readonly machineDecisionScheduleTimer?: MachineDecisionSchedulerOptions['scheduleTimer'];
  readonly machineDecisionCancelTimer?: MachineDecisionSchedulerOptions['cancelTimer'];
  readonly machineLivenessLimits?: MachineLivenessLimits;
  readonly modelInvocationRuntime?: AiModelInvocationRuntime | null;
}

interface MachineStrategyRuntime {
  readonly binding: AiSystemParticipantBinding;
  readonly history: AiSelectedHistoryTracker;
  modelMode: 'MODEL' | 'CONSERVATIVE_FALLBACK';
}

export interface MachineStrategySubmissionMetadata {
  readonly audit: AiStrategyDecisionAudit;
  readonly decisionId: string;
  readonly windowSignature: string;
  readonly modelInvocation?: AiModelInvocationAudit | null;
}

interface PreparedModelMachineDecision {
  readonly participant: OnlineMatchParticipant;
  readonly accountKey: string;
  readonly acquired: Extract<AcquireMachineDecisionLeaseResult, { readonly ok: true }>;
  readonly strategyRuntime: MachineStrategyRuntime;
  readonly observation: AiObservation;
  readonly context: AiStrategyContext;
  readonly deterministicResult: AuditableAiDecisionResult | null;
}

export interface DeleteOnlineMatchOptions {
  readonly reason?: string;
  readonly now?: number;
  readonly preserveRoomCodeSpectators?: boolean;
}

export class OnlineMatchServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OnlineMatchServiceError';
    this.code = code;
  }
}

export class OnlineSpectatorServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryAfterMs?: number;

  constructor(code: string, message: string, statusCode = 400, retryAfterMs?: number) {
    super(message);
    this.name = 'OnlineSpectatorServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

export class OnlineMatchService {
  private readonly matches = new Map<string, OnlineMatchState>();
  private readonly machineStrategyRuntimes = new Map<string, MachineStrategyRuntime>();
  private readonly spectatorLinks = new Map<string, OnlineSpectatorLinkState>();
  private readonly spectatorSessions = new Map<string, OnlineSpectatorSessionState>();
  private readonly spectatorRequestWindows = new Map<
    string,
    { windowStartedAt: number; requestCount: number }
  >();
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly recorder: Pick<
    MatchRecorderService,
    | 'beginMatch'
    | 'recordInitialCheckpoint'
    | 'markPartial'
    | 'sealMatch'
    | 'getRecordCursor'
    | 'appendMatchRecordFrame'
  > | null;
  private readonly spectatorMaxPublicSessions: number;
  private readonly spectatorRequestWindowMs: number;
  private readonly spectatorRequestLimit: number;
  private readonly chatBlockedTerms: readonly string[];
  private readonly sealedMatchIds = new Set<string>();
  private readonly partialRecordMatchIds = new Set<string>();
  private serviceRejectedAttemptSeq = 0;
  private readonly machineDecisionSchedulingEnabled: boolean;
  private readonly machineLivenessLimits: MachineLivenessLimits;
  private readonly modelInvocationRuntime: AiModelInvocationRuntime | null;
  readonly serialExecutor: SingleMatchSerialExecutor;
  readonly deadlineOwner: ServerDeadlineOwner;
  readonly machineDecisionCoordinator: MachineDecisionCoordinator;
  readonly machineDecisionScheduler: MachineDecisionScheduler;

  constructor(deps: OnlineMatchServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.idGenerator = deps.idGenerator ?? randomUUID;
    this.recorder = deps.recorder === undefined ? matchRecorderService : deps.recorder;
    this.spectatorMaxPublicSessions =
      deps.spectatorMaxPublicSessions ?? DEFAULT_SPECTATOR_MAX_PUBLIC_SESSIONS;
    this.spectatorRequestWindowMs =
      deps.spectatorRequestWindowMs ??
      readPositiveIntEnv('ONLINE_SPECTATOR_REQUEST_WINDOW_MS', DEFAULT_SPECTATOR_REQUEST_WINDOW_MS);
    this.spectatorRequestLimit =
      deps.spectatorRequestLimit ??
      readPositiveIntEnv('ONLINE_SPECTATOR_REQUEST_LIMIT', DEFAULT_SPECTATOR_REQUEST_LIMIT);
    this.chatBlockedTerms = deps.chatBlockedTerms ?? readOnlineMatchChatBlockedTerms();
    this.serialExecutor = deps.serialExecutor ?? new SingleMatchSerialExecutor();
    this.machineDecisionSchedulingEnabled = deps.machineDecisionSchedulingEnabled ?? false;
    this.machineLivenessLimits = deps.machineLivenessLimits ?? DEFAULT_MACHINE_LIVENESS_LIMITS;
    this.modelInvocationRuntime = deps.modelInvocationRuntime ?? null;
    this.machineDecisionCoordinator = new MachineDecisionCoordinator({
      executor: this.serialExecutor,
      now: this.now,
      runtimeEpoch: deps.machineDecisionRuntimeEpoch,
      idGenerator: deps.machineDecisionIdGenerator,
      leaseTtlMs: deps.machineDecisionLeaseTtlMs,
    } satisfies MachineDecisionCoordinatorOptions);
    this.machineDecisionScheduler = new MachineDecisionScheduler({
      runtimeEpoch: deps.machineDecisionSchedulerRuntimeEpoch,
      idGenerator: deps.machineDecisionSchedulerIdGenerator,
      retryDelayMs: deps.machineDecisionSchedulerRetryDelayMs,
      maxConsecutiveCallbackFailures: deps.machineDecisionSchedulerMaxCallbackFailures,
      scheduleTimer: deps.machineDecisionScheduleTimer,
      cancelTimer: deps.machineDecisionCancelTimer,
      onDecisionDue: (registration) => this.handleMachineDecisionDue(registration),
      onTerminalFailure: (registration, reason) =>
        this.handleMachineDecisionTerminalFailure(registration, reason),
    });
    this.deadlineOwner = new ServerDeadlineOwner({
      now: this.now,
      runtimeEpoch: deps.deadlineRuntimeEpoch,
      idGenerator: deps.deadlineIdGenerator,
      retryDelayMs: deps.deadlineRetryDelayMs,
      scheduleTimer: deps.deadlineScheduleTimer,
      cancelTimer: deps.deadlineCancelTimer,
      onDeadlineDue: (registration) => this.handleServerDeadlineDue(registration),
    });
  }

  async createMatch(params: CreateOnlineMatchParams): Promise<OnlineMatchState> {
    const matchMode = params.matchMode ?? 'ONLINE';
    const originKind = params.originKind ?? 'ONLINE_ROOM';
    assertSystemParticipantConfiguration(params.first, params.second, matchMode, originKind);
    const matchId = this.idGenerator();
    const automationGameMode = params.automationGameMode ?? 'DEBUG';
    const session = createGameSession({
      gameMode: toGameMode(automationGameMode),
      now: this.now,
    });
    const firstPlayerId = `${matchId}:FIRST:${params.first.userId}`;
    const secondPlayerId = `${matchId}:SECOND:${params.second.userId}`;
    const now = params.startedAt ?? this.now();
    const state: OnlineMatchState = {
      matchId,
      roomCode: params.roomCode,
      matchMode,
      automationGameMode,
      originKind,
      originLabel: params.originLabel ?? params.roomCode,
      session,
      participants: {
        FIRST: {
          userId: params.first.userId,
          playerId: firstPlayerId,
          displayName: params.first.displayName,
          seat: 'FIRST',
          participantKind: params.first.participantKind ?? 'USER',
          ownerUserId: params.first.ownerUserId ?? null,
        },
        SECOND: {
          userId: params.second.userId,
          playerId: secondPlayerId,
          displayName: params.second.displayName,
          seat: 'SECOND',
          participantKind: params.second.participantKind ?? 'USER',
          ownerUserId: params.second.ownerUserId ?? null,
        },
      },
      deckSnapshots: {
        FIRST: createRuntimeDeckSnapshot('FIRST', params.first),
        SECOND: createRuntimeDeckSnapshot('SECOND', params.second),
      },
      systemParticipantBindings: {
        ...(params.first.participantKind === 'SYSTEM' && params.first.systemParticipantBinding
          ? { FIRST: params.first.systemParticipantBinding }
          : {}),
        ...(params.second.participantKind === 'SYSTEM' && params.second.systemParticipantBinding
          ? { SECOND: params.second.systemParticipantBinding }
          : {}),
      },
      startedAt: now,
      remoteRevision: 0,
      recordBranchId: `${matchId}:branch:0`,
      recordCaptureCursor: {
        publicSeq: 0,
        privateSeqBySeat: { FIRST: 0, SECOND: 0 },
        auditSeq: 0,
        commandSeq: 0,
        gameEventSeq: 0,
      },
      pendingUndoRequest: null,
      pendingManualOperationModeRequest: null,
      activeUndoGrant: null,
      machineLiveness: null,
      appliedUndoKeys: new Set<string>(),
      appliedManualOperationKeys: new Map<string, string>(),
      recoveryNotice: null,
      chat: createOnlineMatchChatRuntime(),
      updatedAt: now,
      lastActivityAt: now,
    };

    session.createGame(
      matchId,
      firstPlayerId,
      params.first.displayName,
      secondPlayerId,
      params.second.displayName
    );

    if (this.recorder) {
      try {
        await this.recorder.beginMatch(buildMatchRecorderBeginInputFromOnlineMatch(state));
      } catch {
        throw new OnlineMatchServiceError(
          'ONLINE_MATCH_RECORD_BEGIN_FAILED',
          '历史对局记录创建失败，请稍后重试'
        );
      }
    }

    const initialized = session.initializeGame(
      cloneRuntimeDeck(params.first.deck),
      cloneRuntimeDeck(params.second.deck)
    );
    if (!initialized.success) {
      await this.markRecordIncomplete(
        matchId,
        'CORRUPTED',
        'initialize failed',
        initialized.error ?? '正式联机对局初始化失败'
      );
      throw new Error(initialized.error ?? '正式联机对局初始化失败');
    }
    state.remoteRevision = session.getCurrentPublicEventSeq();
    state.recordCaptureCursor = session.getRuntimeCaptureCursor();

    if (this.recorder) {
      const authorityState = session.getAuthoritySnapshotForRecord();
      if (!authorityState) {
        await this.markRecordIncomplete(
          matchId,
          'CORRUPTED',
          'initial authority snapshot missing',
          '初始权威状态不存在'
        );
        throw new OnlineMatchServiceError(
          'ONLINE_MATCH_RECORD_CHECKPOINT_FAILED',
          '历史对局初始检查点写入失败：初始权威状态不存在'
        );
      }

      try {
        await this.recorder.recordInitialCheckpoint({
          matchId,
          authorityState,
          relatedPublicSeq: session.getCurrentPublicEventSeq(),
          relatedCommandSeq: null,
          relatedGameEventSeq: session.getCurrentGameEventSeq(),
          createdAt: now,
        });
      } catch (error) {
        await this.markRecordIncomplete(
          matchId,
          'CORRUPTED',
          'initial checkpoint failed',
          readErrorMessage(error)
        );
        throw new OnlineMatchServiceError(
          'ONLINE_MATCH_RECORD_CHECKPOINT_FAILED',
          '历史对局初始检查点写入失败，请稍后重试'
        );
      }
    }

    this.matches.set(matchId, state);
    for (const seat of ['FIRST', 'SECOND'] as const) {
      const binding = state.systemParticipantBindings[seat];
      if (binding) {
        this.machineStrategyRuntimes.set(buildMachineStrategyRuntimeKey(matchId, seat), {
          binding,
          history: createAiSelectedHistoryTracker(seat),
          modelMode: 'MODEL',
        });
      }
    }
    if (Object.keys(state.systemParticipantBindings).length > 0) {
      this.appendMachineSystemNotice(
        state,
        'AI_MATCH_READY',
        `ai-match-ready:${matchId}`,
        '本局对手是 Loveca AI，使用固定测试卡组并由系统自动操作。'
      );
    }
    this.reconcileServerDeadline(state);
    this.reconcileMachineDecisionScheduling(state);
    return state;
  }

  getMatch(matchId: string): OnlineMatchState | null {
    return this.matches.get(matchId) ?? null;
  }

  /**
   * Trusted machine-decision read boundary. The coordinator must call this
   * from the shared per-match critical section so contract generation cannot
   * race an authority write.
   */
  private readMachineAuthoritySnapshot(
    matchId: string,
    criticalSection?: SingleMatchCriticalSection
  ): MachineAuthoritySnapshot | null {
    if (!this.serialExecutor.isExecutingMatch(matchId, criticalSection)) {
      throw new OnlineMatchServiceError(
        'ONLINE_MATCH_MACHINE_READ_OUTSIDE_CRITICAL_SECTION',
        '机器决策权威读取必须位于单局临界区'
      );
    }
    const match = this.matches.get(matchId);
    const game = match?.session.state;
    return match && game ? { game, authorityRevision: match.remoteRevision } : null;
  }

  /**
   * The only service-level entry for beginning a formal AI decision. Resolving
   * the SYSTEM player here prevents callers from constructing a coordinator
   * around the lower-level trusted command path.
   */
  async acquireMachineDecisionLease(input: {
    readonly matchId: string;
    readonly systemUserId: string;
    readonly ownerId: string;
  }): Promise<AcquireMachineDecisionLeaseResult> {
    return this.serialExecutor.runExclusive(input.matchId, (criticalSection) => {
      const match = this.matches.get(input.matchId);
      const participant = match ? getParticipantByUserId(match, input.systemUserId) : null;
      if (
        !match ||
        match.originKind !== 'AI_BATTLE' ||
        !participant ||
        participant.participantKind !== 'SYSTEM' ||
        !match.systemParticipantBindings[participant.seat]
      ) {
        return {
          ok: false,
          reason: 'INVALID_STATE',
          detail: '机器决策 lease 只能为正式 AI 对局的 SYSTEM 参赛者创建',
        };
      }
      return this.machineDecisionCoordinator.acquireLeaseInCriticalSection(criticalSection, {
        matchId: match.matchId,
        playerId: participant.playerId,
        ownerId: input.ownerId,
        readAuthoritySnapshot: (section) =>
          this.readMachineAuthoritySnapshot(match.matchId, section),
      });
    });
  }

  /**
   * The only service-level entry for submitting a machine choice. The active
   * lease determines the SYSTEM identity; callers cannot supply a raw command.
   */
  async submitMachineDecisionSelection(input: {
    readonly matchId: string;
    readonly leaseId: string;
    readonly ownerId: string;
    readonly selection: AiDecisionSelection;
  }): Promise<SubmitMachineDecisionResult> {
    return this.serialExecutor.runExclusive(input.matchId, async (criticalSection) => {
      const match = this.matches.get(input.matchId);
      const activeLease = (['FIRST', 'SECOND'] as const)
        .map((seat) => this.machineDecisionCoordinator.getActiveLease(input.matchId, seat))
        .find((lease) => lease?.leaseId === input.leaseId);
      const participant = match && activeLease ? match.participants[activeLease.seat] : null;
      if (
        !match ||
        match.originKind !== 'AI_BATTLE' ||
        !activeLease ||
        !participant ||
        participant.participantKind !== 'SYSTEM' ||
        participant.playerId !== activeLease.playerId ||
        !match.systemParticipantBindings[participant.seat]
      ) {
        return {
          ok: false,
          reason: 'LEASE_NOT_FOUND',
          detail: '正式 AI 对局的 decision lease 不存在或已经失效',
        };
      }
      return this.machineDecisionCoordinator.submitSelectionInCriticalSection(criticalSection, {
        matchId: match.matchId,
        leaseId: input.leaseId,
        ownerId: input.ownerId,
        selection: input.selection,
        readAuthoritySnapshot: (section) =>
          this.readMachineAuthoritySnapshot(match.matchId, section),
        executeCommand: (command, expectedRevision, section) =>
          this.#executeMachineCommandAtRevisionInCriticalSection(
            match.matchId,
            participant.userId,
            command,
            expectedRevision,
            section
          ),
      });
    });
  }

  /**
   * Trusted command sink used only after an in-service decision coordinator
   * has validated the current lease, window and selection.
   */
  async #executeMachineCommandAtRevisionInCriticalSection(
    matchId: string,
    systemUserId: string,
    command: GameCommand,
    expectedRevision: number,
    criticalSection?: SingleMatchCriticalSection,
    strategySubmission?: MachineStrategySubmissionMetadata
  ): Promise<MachineCommandExecutionResult> {
    if (!this.serialExecutor.isExecutingMatch(matchId, criticalSection)) {
      throw new OnlineMatchServiceError(
        'ONLINE_MATCH_MACHINE_WRITE_OUTSIDE_CRITICAL_SECTION',
        '机器命令权威写入必须位于单局临界区'
      );
    }
    const match = this.matches.get(matchId);
    const participant = match ? getParticipantByUserId(match, systemUserId) : null;
    if (!match || !participant || participant.participantKind !== 'SYSTEM') {
      return {
        success: false,
        authorityRevision: match?.remoteRevision ?? expectedRevision,
        error: '机器命令只能由当前对局的 SYSTEM 参赛者提交',
      };
    }
    if (match.remoteRevision !== expectedRevision) {
      return {
        success: false,
        authorityRevision: match.remoteRevision,
        error: '权威 revision 已变化，机器命令已过期',
      };
    }
    const result = await this.executeCommandInCriticalSection(matchId, systemUserId, command, {
      trustedSystemSubmission: true,
      strategySubmission,
    });
    return {
      success: result?.success === true,
      authorityRevision: match.remoteRevision,
      error: result?.success === false ? result.error : result ? undefined : '对局不存在',
    };
  }

  private async handleServerDeadlineDue(registration: ServerDeadlineRegistration): Promise<void> {
    await this.serialExecutor.runExclusive(registration.matchId, async () => {
      if (!this.deadlineOwner.isCurrent(registration)) {
        return;
      }
      const match = this.matches.get(registration.matchId);
      const game = match?.session.state;
      if (!match || !game) {
        this.deadlineOwner.cancelMatch(registration.matchId);
        return;
      }

      const descriptor = readServerDeadlineDescriptor(game);
      if (
        match.remoteRevision !== registration.authorityRevision ||
        !descriptor ||
        descriptor.windowSignature !== registration.windowSignature
      ) {
        this.reconcileServerDeadline(match);
        return;
      }
      if (this.now() < registration.autoAdvanceAt) {
        this.reconcileServerDeadline(match);
        return;
      }

      const preferredPlayerId = game.activeEffect?.awaitingPlayerId;
      const participant =
        Object.values(match.participants).find(
          (candidate) => candidate.playerId === preferredPlayerId
        ) ?? match.participants.FIRST;
      const baseCommand =
        registration.kind === 'PUBLIC_CARD_SELECTION'
          ? createAutoAdvancePublicCardSelectionCommand(
              participant.playerId,
              registration.effectId,
              registration.autoAdvanceAt
            )
          : createAutoAdvancePublicEffectChoiceCommand(
              participant.playerId,
              registration.effectId,
              registration.autoAdvanceAt
            );
      await this.executeCommandInCriticalSection(registration.matchId, participant.userId, {
        ...baseCommand,
        timestamp: this.now(),
      });
    });
  }

  private async handleMachineDecisionDue(
    registration: MachineDecisionScheduleRegistration
  ): Promise<MachineDecisionScheduleResult> {
    return this.modelInvocationRuntime
      ? this.handleModelMachineDecisionDue(registration)
      : this.handleExplainableMachineDecisionDue(registration);
  }

  private async handleExplainableMachineDecisionDue(
    registration: MachineDecisionScheduleRegistration
  ): Promise<MachineDecisionScheduleResult> {
    return this.serialExecutor.runExclusive(registration.matchId, async (criticalSection) => {
      if (!this.machineDecisionScheduler.isCurrent(registration)) return 'IDLE';
      const match = this.matches.get(registration.matchId);
      const game = match?.session.state;
      if (!match || !game || !this.shouldScheduleMachineDecisions(match)) {
        return game?.isEnded ? 'TERMINAL' : 'IDLE';
      }
      const systemParticipants = (['FIRST', 'SECOND'] as const)
        .filter((seat) => !!match.systemParticipantBindings[seat])
        .map((seat) => match.participants[seat])
        .filter(
          (participant) =>
            participant.participantKind === 'SYSTEM' &&
            isCertifiedAiSystemParticipantBinding(
              match.systemParticipantBindings[participant.seat]!
            )
        );
      const terminalParticipant = systemParticipants[0];
      const terminateMachineFailure = async (
        detail: string
      ): Promise<MachineDecisionScheduleResult> => {
        if (!terminalParticipant) return 'BLOCKED';
        const terminated = await this.terminateMachineDecisionFailureInCriticalSection(
          match,
          terminalParticipant,
          `ai-machine-failure:${registration.runtimeEpoch}`,
          detail,
          criticalSection
        );
        return terminated ? 'TERMINAL' : 'BLOCKED';
      };
      if (terminalParticipant && match.machineLiveness?.terminalReason) {
        this.appendMachineSystemNotice(
          match,
          'AI_LIVENESS_CONCEDE',
          `ai-liveness-concede:${match.machineLiveness.policyVersion}`,
          buildMachineLivenessConcessionNotice(match.machineLiveness.terminalReason)
        );
        const terminal = await this.#executeMachineCommandAtRevisionInCriticalSection(
          match.matchId,
          terminalParticipant.userId,
          {
            ...createSystemConcedeCommand(
              terminalParticipant.playerId,
              match.machineLiveness.terminalReason
            ),
            timestamp: this.now(),
          },
          match.remoteRevision,
          criticalSection
        );
        return terminal.success
          ? 'TERMINAL'
          : terminateMachineFailure('AI 无法继续处理当前操作，本局已结束。');
      }
      if (readServerDeadlineDescriptor(game)) {
        return 'IDLE';
      }
      const awaitingPlayerId = game.activeEffect?.awaitingPlayerId;
      for (const participant of systemParticipants) {
        // Public-display contracts are intentionally visible to both seats,
        // but only the deadline owner may advance another seat's display.
        if (awaitingPlayerId && awaitingPlayerId !== participant.playerId) continue;
        const acquired = this.machineDecisionCoordinator.acquireLeaseInCriticalSection(
          criticalSection,
          {
            matchId: match.matchId,
            playerId: participant.playerId,
            ownerId: this.machineDecisionScheduler.runtimeEpoch,
            readAuthoritySnapshot: (section) =>
              this.readMachineAuthoritySnapshot(match.matchId, section),
          }
        );
        if (!acquired.ok) {
          if (acquired.reason === 'NO_DECISION') continue;
          return acquired.reason === 'LEASE_HELD_BY_OTHER_OWNER'
            ? 'RETRY'
            : terminateMachineFailure('AI 无法读取当前可选操作，本局已结束。');
        }

        const strategyRuntime = this.machineStrategyRuntimes.get(
          buildMachineStrategyRuntimeKey(match.matchId, participant.seat)
        );
        let strategySubmission: MachineStrategySubmissionMetadata | undefined;
        let acceptedHistory:
          | {
              readonly observation: ReturnType<typeof buildAiObservation>;
              readonly result: Extract<
                ReturnType<typeof selectExplainableDecision>,
                { readonly ok: true }
              >;
            }
          | undefined;
        const selected = strategyRuntime
          ? (() => {
              const view = match.session.getPlayerViewState(participant.playerId, {
                seqOverride: match.remoteRevision,
              });
              if (!view) return null;
              const observation = buildAiObservation(view, acquired.contract);
              const context = buildAiStrategyContext({
                observation,
                deckKey: strategyRuntime.binding.deckKey,
                deckContentHash: strategyRuntime.binding.deckContentHash,
                selectedHistory: strategyRuntime.history.observe(observation),
              });
              const result = selectExplainableDecision(context);
              if (!result.ok) return null;
              strategySubmission = {
                audit: createAiStrategyDecisionAudit(context, result),
                decisionId: acquired.contract.decisionId,
                windowSignature: acquired.contract.windowSignature,
              };
              acceptedHistory = { observation, result };
              return result;
            })()
          : selectConservativeDecision(acquired.contract);
        if (!selected?.ok) {
          return terminateMachineFailure('AI 无法完成当前允许的操作，本局已结束。');
        }
        const before = game;
        const submitted = await this.machineDecisionCoordinator.submitSelectionInCriticalSection(
          criticalSection,
          {
            matchId: match.matchId,
            leaseId: acquired.lease.leaseId,
            ownerId: this.machineDecisionScheduler.runtimeEpoch,
            selection: selected.selection,
            readAuthoritySnapshot: (section) =>
              this.readMachineAuthoritySnapshot(match.matchId, section),
            executeCommand: (command, expectedRevision, section) =>
              this.#executeMachineCommandAtRevisionInCriticalSection(
                match.matchId,
                participant.userId,
                command,
                expectedRevision,
                section,
                strategySubmission
              ),
          }
        );
        if (submitted.ok) {
          if (strategyRuntime && acceptedHistory) {
            strategyRuntime.history.recordAcceptedDecision(
              acceptedHistory.observation,
              acceptedHistory.result
            );
          }
          const after = match.session.state;
          if (!after) {
            return terminateMachineFailure('AI 操作后无法继续读取牌局，本局已结束。');
          }
          const strategyMode: MachineStrategyMode = strategyRuntime
            ? 'PRIMARY'
            : 'CONSERVATIVE_FALLBACK';
          const firstConservativeDecision =
            strategyMode === 'CONSERVATIVE_FALLBACK' &&
            match.machineLiveness?.strategyMode !== 'CONSERVATIVE_FALLBACK';
          const previous =
            match.machineLiveness ?? createMachineLivenessState(before, this.now(), strategyMode);
          const liveness = recordMachineLivenessDecision({
            previous,
            before,
            after,
            systemPlayerId: participant.playerId,
            now: this.now(),
            strategyMode,
            limits: this.machineLivenessLimits,
          });
          match.machineLiveness = liveness.state;
          if (firstConservativeDecision) {
            this.appendMachineSystemNotice(
              match,
              'AI_FALLBACK_ENABLED',
              `ai-fallback-enabled:${liveness.state.policyVersion}`,
              'AI 已改用稳妥操作继续本局。'
            );
          }
          if (liveness.terminalReason && !after.isEnded) {
            this.appendMachineSystemNotice(
              match,
              'AI_LIVENESS_CONCEDE',
              `ai-liveness-concede:${liveness.state.policyVersion}`,
              buildMachineLivenessConcessionNotice(liveness.terminalReason)
            );
            const terminal = await this.#executeMachineCommandAtRevisionInCriticalSection(
              match.matchId,
              participant.userId,
              {
                ...createSystemConcedeCommand(participant.playerId, liveness.terminalReason),
                timestamp: this.now(),
              },
              match.remoteRevision,
              criticalSection
            );
            return terminal.success
              ? 'TERMINAL'
              : terminateMachineFailure('AI 无法继续处理当前操作，本局已结束。');
          }
          return after.isEnded ? 'TERMINAL' : 'PROGRESSED';
        }
        return submitted.reason === 'LEASE_EXPIRED' ||
          submitted.reason === 'AUTHORITY_REVISION_CHANGED' ||
          submitted.reason === 'WINDOW_CHANGED' ||
          submitted.reason === 'LEASE_NOT_FOUND'
          ? 'RETRY'
          : terminateMachineFailure('AI 的操作未能通过规则检查，本局已结束。');
      }
      return 'IDLE';
    });
  }

  /**
   * Phase 4 model path. Preparation and submission each run in the shared
   * per-match critical section; the network wait between them deliberately
   * does not. The decision lease is the only bridge across that wait.
   */
  private async handleModelMachineDecisionDue(
    registration: MachineDecisionScheduleRegistration
  ): Promise<MachineDecisionScheduleResult> {
    const prepared = await this.serialExecutor.runExclusive(
      registration.matchId,
      async (
        criticalSection
      ): Promise<PreparedModelMachineDecision | MachineDecisionScheduleResult> => {
        if (!this.machineDecisionScheduler.isCurrent(registration)) return 'IDLE';
        const match = this.matches.get(registration.matchId);
        const game = match?.session.state;
        if (!match || !game || !this.shouldScheduleMachineDecisions(match)) {
          return game?.isEnded ? 'TERMINAL' : 'IDLE';
        }
        const participant = (['FIRST', 'SECOND'] as const)
          .map((seat) => match.participants[seat])
          .find(
            (candidate) =>
              candidate.participantKind === 'SYSTEM' &&
              !!match.systemParticipantBindings[candidate.seat] &&
              isCertifiedAiSystemParticipantBinding(
                match.systemParticipantBindings[candidate.seat]!
              )
          );
        if (!participant) return 'BLOCKED';

        if (match.machineLiveness?.terminalReason) {
          this.appendMachineSystemNotice(
            match,
            'AI_LIVENESS_CONCEDE',
            `ai-liveness-concede:${match.machineLiveness.policyVersion}`,
            buildMachineLivenessConcessionNotice(match.machineLiveness.terminalReason)
          );
          const terminal = await this.#executeMachineCommandAtRevisionInCriticalSection(
            match.matchId,
            participant.userId,
            {
              ...createSystemConcedeCommand(
                participant.playerId,
                match.machineLiveness.terminalReason
              ),
              timestamp: this.now(),
            },
            match.remoteRevision,
            criticalSection
          );
          return terminal.success ? 'TERMINAL' : 'BLOCKED';
        }
        if (readServerDeadlineDescriptor(game)) return 'IDLE';
        if (
          game.activeEffect?.awaitingPlayerId &&
          game.activeEffect.awaitingPlayerId !== participant.playerId
        ) {
          return 'IDLE';
        }

        const acquired = this.machineDecisionCoordinator.acquireLeaseInCriticalSection(
          criticalSection,
          {
            matchId: match.matchId,
            playerId: participant.playerId,
            ownerId: this.machineDecisionScheduler.runtimeEpoch,
            readAuthoritySnapshot: (section) =>
              this.readMachineAuthoritySnapshot(match.matchId, section),
          }
        );
        if (!acquired.ok) {
          if (acquired.reason === 'NO_DECISION') return 'IDLE';
          return acquired.reason === 'LEASE_HELD_BY_OTHER_OWNER' ? 'RETRY' : 'BLOCKED';
        }

        const strategyRuntime = this.machineStrategyRuntimes.get(
          buildMachineStrategyRuntimeKey(match.matchId, participant.seat)
        );
        const view = match.session.getPlayerViewState(participant.playerId, {
          seqOverride: match.remoteRevision,
        });
        if (!strategyRuntime || !view) return 'BLOCKED';
        const observation = buildAiObservation(view, acquired.contract);
        const context = buildAiStrategyContext({
          observation,
          deckKey: strategyRuntime.binding.deckKey,
          deckContentHash: strategyRuntime.binding.deckContentHash,
          selectedHistory: strategyRuntime.history.observe(observation),
        });
        const explainable = selectExplainableDecision(context);
        if (!explainable.ok) return 'BLOCKED';
        const accountKey =
          Object.values(match.participants).find(
            (candidate) => candidate.participantKind === 'USER'
          )?.userId ?? `match:${match.matchId}`;
        return {
          participant,
          accountKey,
          acquired,
          strategyRuntime,
          observation,
          context,
          deterministicResult:
            strategyRuntime.modelMode === 'CONSERVATIVE_FALLBACK'
              ? createConservativeAuditableResult(acquired.contract)
              : explainable.tier === 'HEURISTIC'
                ? null
                : explainable,
        };
      }
    );
    if (typeof prepared === 'string') return prepared;

    if (prepared.deterministicResult) {
      const submitted = await this.submitPreparedModelMachineDecision({
        registration,
        prepared,
        result: prepared.deterministicResult,
        modelInvocation: null,
        strategyMode:
          prepared.strategyRuntime.modelMode === 'CONSERVATIVE_FALLBACK'
            ? 'CONSERVATIVE_FALLBACK'
            : 'PRIMARY',
      });
      return submitted.result;
    }

    const attempts: AiModelInvocationAttemptAudit[] = [];
    let repairFailureCode: AiModelRepairFailureCode | undefined;
    let transportRetryFailureCode: AiModelTransportRetryFailureCode | undefined;

    for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
      const envelope = buildAiModelRequestEnvelope({
        strategyContext: prepared.context,
        repairFailureCode,
        transportRetryFailureCode,
      });
      const invoked = await this.modelInvocationRuntime!.invoke({
        matchId: registration.matchId,
        accountKey: prepared.accountKey,
        envelope,
      });
      if (!invoked.ok) {
        attempts.push(invoked.audit);
        if (invoked.outcome === 'ABORTED') return 'RETRY';
        if (attemptNumber === 1 && invoked.retryable) {
          transportRetryFailureCode =
            invoked.outcome === 'TIMEOUT' ? 'TIMEOUT' : 'PROVIDER_RETRYABLE';
          continue;
        }
        break;
      }

      const parsed = parseAiModelDecisionOutput(invoked.rawOutput);
      if (!parsed.ok) {
        attempts.push(withModelAttemptOutcome(invoked.audit, parsed.reason));
        if (attemptNumber === 1) {
          repairFailureCode = parsed.reason;
          transportRetryFailureCode = undefined;
          continue;
        }
        break;
      }

      attempts.push(invoked.audit);
      const modelResult: AuditableAiDecisionResult = {
        policyVersion: AI_MODEL_DECISION_POLICY_VERSION,
        tier: 'HEURISTIC',
        reasonCode: 'MODEL_STRUCTURED_SELECTION',
        summary: parsed.output.summary,
        consideredIds: collectModelConsideredIds(prepared.context),
        selection: parsed.output.selection,
      };
      const submitted = await this.submitPreparedModelMachineDecision({
        registration,
        prepared,
        result: modelResult,
        modelInvocation: this.modelInvocationRuntime!.createAudit(attempts, 'MODEL_SELECTION'),
        strategyMode: 'PRIMARY',
      });
      if (!submitted.invalidSelection) return submitted.result;

      attempts[attempts.length - 1] = withModelAttemptOutcome(
        attempts[attempts.length - 1]!,
        'INVALID_SELECTION'
      );
      if (attemptNumber === 1) {
        repairFailureCode = 'INVALID_SELECTION';
        transportRetryFailureCode = undefined;
        continue;
      }
      break;
    }

    const fallback = createConservativeAuditableResult(prepared.acquired.contract);
    if (!fallback) {
      return this.terminatePreparedModelFailure(
        registration,
        prepared.participant,
        'AI 无法完成当前操作，本局已因 AI 操作异常结束。'
      );
    }
    return (
      await this.submitPreparedModelMachineDecision({
        registration,
        prepared,
        result: fallback,
        modelInvocation: this.modelInvocationRuntime!.createAudit(
          attempts,
          'CONSERVATIVE_FALLBACK'
        ),
        strategyMode: 'CONSERVATIVE_FALLBACK',
      })
    ).result;
  }

  private async submitPreparedModelMachineDecision(input: {
    readonly registration: MachineDecisionScheduleRegistration;
    readonly prepared: PreparedModelMachineDecision;
    readonly result: AuditableAiDecisionResult;
    readonly modelInvocation: AiModelInvocationAudit | null;
    readonly strategyMode: MachineStrategyMode;
  }): Promise<{
    readonly result: MachineDecisionScheduleResult;
    readonly invalidSelection: boolean;
  }> {
    return this.serialExecutor.runExclusive(input.registration.matchId, async (criticalSection) => {
      const match = this.matches.get(input.registration.matchId);
      const game = match?.session.state;
      if (
        !match ||
        !game ||
        !this.machineDecisionScheduler.isCurrent(input.registration) ||
        !this.shouldScheduleMachineDecisions(match)
      ) {
        return {
          result: game?.isEnded ? ('TERMINAL' as const) : ('RETRY' as const),
          invalidSelection: false,
        };
      }
      if (input.strategyMode === 'CONSERVATIVE_FALLBACK') {
        input.prepared.strategyRuntime.modelMode = 'CONSERVATIVE_FALLBACK';
      }
      const before = game;
      const strategySubmission: MachineStrategySubmissionMetadata = {
        audit: createAiStrategyDecisionAudit(input.prepared.context, input.result),
        decisionId: input.prepared.acquired.contract.decisionId,
        windowSignature: input.prepared.acquired.contract.windowSignature,
        modelInvocation: input.modelInvocation,
      };
      const submitted = await this.machineDecisionCoordinator.submitSelectionInCriticalSection(
        criticalSection,
        {
          matchId: match.matchId,
          leaseId: input.prepared.acquired.lease.leaseId,
          ownerId: this.machineDecisionScheduler.runtimeEpoch,
          selection: input.result.selection,
          readAuthoritySnapshot: (section) =>
            this.readMachineAuthoritySnapshot(match.matchId, section),
          executeCommand: (command, expectedRevision, section) =>
            this.#executeMachineCommandAtRevisionInCriticalSection(
              match.matchId,
              input.prepared.participant.userId,
              command,
              expectedRevision,
              section,
              strategySubmission
            ),
        }
      );
      if (!submitted.ok) {
        if (submitted.reason === 'INVALID_SELECTION') {
          return { result: 'RETRY' as const, invalidSelection: true };
        }
        const retryable =
          submitted.reason === 'LEASE_EXPIRED' ||
          submitted.reason === 'AUTHORITY_REVISION_CHANGED' ||
          submitted.reason === 'WINDOW_CHANGED' ||
          submitted.reason === 'LEASE_NOT_FOUND';
        if (retryable) return { result: 'RETRY' as const, invalidSelection: false };
        const terminated = await this.terminateMachineDecisionFailureInCriticalSection(
          match,
          input.prepared.participant,
          `ai-machine-failure:${input.registration.runtimeEpoch}`,
          'AI 的操作未能通过规则检查，本局已结束。',
          criticalSection
        );
        return {
          result: terminated ? ('TERMINAL' as const) : ('BLOCKED' as const),
          invalidSelection: false,
        };
      }

      input.prepared.strategyRuntime.history.recordAcceptedDecision(
        input.prepared.observation,
        input.result
      );
      const after = match.session.state;
      if (!after) return { result: 'BLOCKED' as const, invalidSelection: false };

      if (input.strategyMode === 'CONSERVATIVE_FALLBACK') {
        this.appendMachineSystemNotice(
          match,
          'AI_FALLBACK_ENABLED',
          `ai-fallback-enabled:${AI_MODEL_DECISION_POLICY_VERSION}`,
          'AI 暂时无法正常选择，本局接下来会只做稳妥操作继续。'
        );
      }
      const previous =
        match.machineLiveness ?? createMachineLivenessState(before, this.now(), input.strategyMode);
      const liveness = recordMachineLivenessDecision({
        previous,
        before,
        after,
        systemPlayerId: input.prepared.participant.playerId,
        now: this.now(),
        strategyMode: input.strategyMode,
        limits: this.machineLivenessLimits,
      });
      match.machineLiveness = liveness.state;
      if (liveness.terminalReason && !after.isEnded) {
        this.appendMachineSystemNotice(
          match,
          'AI_LIVENESS_CONCEDE',
          `ai-liveness-concede:${liveness.state.policyVersion}`,
          buildMachineLivenessConcessionNotice(liveness.terminalReason)
        );
        const terminal = await this.#executeMachineCommandAtRevisionInCriticalSection(
          match.matchId,
          input.prepared.participant.userId,
          {
            ...createSystemConcedeCommand(
              input.prepared.participant.playerId,
              liveness.terminalReason
            ),
            timestamp: this.now(),
          },
          match.remoteRevision,
          criticalSection
        );
        return {
          result: terminal.success ? ('TERMINAL' as const) : ('BLOCKED' as const),
          invalidSelection: false,
        };
      }
      return {
        result: after.isEnded ? ('TERMINAL' as const) : ('PROGRESSED' as const),
        invalidSelection: false,
      };
    });
  }

  private async terminatePreparedModelFailure(
    registration: MachineDecisionScheduleRegistration,
    participant: OnlineMatchParticipant,
    detail: string
  ): Promise<MachineDecisionScheduleResult> {
    return this.serialExecutor.runExclusive(registration.matchId, async (criticalSection) => {
      const match = this.matches.get(registration.matchId);
      if (!match || match.session.state?.isEnded) return 'TERMINAL';
      const terminated = await this.terminateMachineDecisionFailureInCriticalSection(
        match,
        participant,
        `ai-machine-failure:${registration.runtimeEpoch}`,
        detail,
        criticalSection
      );
      return terminated ? 'TERMINAL' : 'BLOCKED';
    });
  }

  private async handleMachineDecisionTerminalFailure(
    registration: MachineDecisionScheduleRegistration,
    reason: MachineDecisionScheduleFailureReason
  ): Promise<void> {
    await this.serialExecutor.runExclusive(registration.matchId, async (criticalSection) => {
      if (!this.machineDecisionScheduler.isCurrent(registration)) return;
      const match = this.matches.get(registration.matchId);
      const game = match?.session.state;
      if (!match || !game || game.isEnded || !this.shouldScheduleMachineDecisions(match)) {
        return;
      }
      const participant = (['FIRST', 'SECOND'] as const)
        .map((seat) => match.participants[seat])
        .find((candidate) => candidate.participantKind === 'SYSTEM');
      if (!participant) {
        throw new Error('机器调度终端失败处理找不到 SYSTEM 参赛者');
      }
      const terminated = await this.terminateMachineDecisionFailureInCriticalSection(
        match,
        participant,
        `ai-machine-failure:${registration.runtimeEpoch}`,
        reason === 'BLOCKED'
          ? 'AI 无法完成当前允许的操作，本局已结束。'
          : 'AI 连续多次无法正常操作，本局已结束。',
        criticalSection
      );
      if (!terminated && !match.session.state?.isEnded) {
        throw new Error('机器决策异常终局提交失败');
      }
    });
  }

  private async terminateMachineDecisionFailureInCriticalSection(
    match: OnlineMatchState,
    participant: OnlineMatchParticipant,
    dedupeKey: string,
    text: string,
    criticalSection: SingleMatchCriticalSection
  ): Promise<boolean> {
    this.appendMachineSystemNotice(match, 'AI_MACHINE_FAILURE', dedupeKey, text);
    const terminal = await this.#executeMachineCommandAtRevisionInCriticalSection(
      match.matchId,
      participant.userId,
      {
        ...createSystemConcedeCommand(participant.playerId, 'MACHINE_DECISION_FAILURE'),
        timestamp: this.now(),
      },
      match.remoteRevision,
      criticalSection
    );
    return terminal.success;
  }

  private incrementAuthorityRevision(match: OnlineMatchState): void {
    this.modelInvocationRuntime?.cancelMatch(match.matchId);
    incrementRemoteRevision(match);
    this.reconcileServerDeadline(match);
    this.reconcileMachineDecisionScheduling(match);
  }

  private reconcileServerDeadline(match: OnlineMatchState): void {
    const game = match.session.state;
    this.deadlineOwner.reconcileMatch(
      match.matchId,
      game ? { game, authorityRevision: match.remoteRevision } : null
    );
  }

  private reconcileMachineDecisionScheduling(match: OnlineMatchState): void {
    if (this.shouldScheduleMachineDecisions(match)) {
      this.machineDecisionScheduler.requestMatch(match.matchId);
    } else {
      this.machineDecisionScheduler.cancelMatch(match.matchId);
    }
  }

  private shouldScheduleMachineDecisions(match: OnlineMatchState): boolean {
    const game = match.session.state;
    return (
      this.machineDecisionSchedulingEnabled &&
      match.matchMode === 'ONLINE' &&
      !!game &&
      !game.isEnded &&
      !match.pendingUndoRequest &&
      !match.pendingManualOperationModeRequest &&
      !match.activeUndoGrant &&
      isFormalAiMatch(match)
    );
  }

  private appendMachineSystemNotice(
    match: OnlineMatchState,
    noticeCode: OnlineMatchSystemNoticeCode,
    dedupeKey: string,
    text: string
  ): OnlineMatchChatMessage {
    return appendOnlineMatchSystemNotice(
      match.chat,
      { noticeCode, dedupeKey, text },
      { now: this.now() }
    );
  }

  isMatchCompleted(matchId: string): boolean {
    const match = this.matches.get(matchId);
    return match?.session.getAuthoritySnapshotForRecord()?.currentPhase === GamePhase.GAME_END;
  }

  async restoreMatch(match: OnlineMatchState): Promise<OnlineMatchState> {
    return this.serialExecutor.runExclusive(match.matchId, (criticalSection) =>
      this.restoreMatchInCriticalSection(match, criticalSection)
    );
  }

  private async restoreMatchInCriticalSection(
    match: OnlineMatchState,
    criticalSection: SingleMatchCriticalSection
  ): Promise<OnlineMatchState> {
    assertRestoredSystemParticipantConfiguration(match);
    const existing = this.matches.get(match.matchId);
    if (existing) {
      this.reconcileServerDeadline(existing);
      this.reconcileMachineDecisionScheduling(existing);
      return existing;
    }

    this.machineDecisionCoordinator.invalidateMatchInCriticalSection(
      criticalSection,
      match.matchId
    );
    this.sealedMatchIds.delete(match.matchId);
    this.matches.set(match.matchId, match);
    for (const seat of ['FIRST', 'SECOND'] as const) {
      const binding = match.systemParticipantBindings[seat];
      if (binding) {
        this.machineStrategyRuntimes.set(buildMachineStrategyRuntimeKey(match.matchId, seat), {
          binding,
          history: createAiSelectedHistoryTracker(seat),
          modelMode: 'MODEL',
        });
      }
    }
    this.reconcileServerDeadline(match);
    this.reconcileMachineDecisionScheduling(match);
    if (match.recoveryNotice) {
      await this.appendSessionRecordFrame(match, 'SYSTEM_TRANSITION', {
        summary: buildRecoverySummary(match.recoveryNotice),
        force: true,
        writeAuthorityCheckpoint: true,
        dedupeKey: buildRecoveryDedupeKey(match, match.recoveryNotice),
      });
    }

    return match;
  }

  getRuntimeStats(
    now = this.now(),
    activeMatchIds: ReadonlySet<string> = new Set()
  ): OnlineMatchRuntimeStats {
    const matchCountByMode: Record<MatchMode, number> = {
      ONLINE: 0,
      SOLITAIRE: 0,
    };
    let staleMatchCount = 0;
    let oldestLastActivityAgeMs: number | null = null;
    let maxSessionStats: OnlineMatchRuntimeStats['maxSessionStats'] = null;

    for (const [matchId, match] of this.matches) {
      matchCountByMode[match.matchMode] += 1;
      const lastActivityAgeMs = Math.max(0, now - match.lastActivityAt);
      oldestLastActivityAgeMs =
        oldestLastActivityAgeMs === null
          ? lastActivityAgeMs
          : Math.max(oldestLastActivityAgeMs, lastActivityAgeMs);
      if (!activeMatchIds.has(matchId) && lastActivityAgeMs > MATCH_STALE_TTL_MS) {
        staleMatchCount += 1;
      }

      const session = match.session.getRuntimeStats();
      const currentMax = maxSessionStats?.session;
      if (
        !currentMax ||
        session.authoritySnapshotCount > currentMax.authoritySnapshotCount ||
        session.publicEventCount > currentMax.publicEventCount ||
        session.commandLogCount > currentMax.commandLogCount
      ) {
        maxSessionStats = {
          matchId,
          matchMode: match.matchMode,
          lastActivityAgeMs,
          session,
        };
      }
    }

    return {
      now,
      matchCount: this.matches.size,
      matchCountByMode,
      staleMatchCount,
      oldestLastActivityAgeMs,
      spectatorLinkCount: this.spectatorLinks.size,
      spectatorSessionCount: this.spectatorSessions.size,
      maxSessionStats,
    };
  }

  getAdminMatchSummary(matchId: string, now = Date.now()): OnlineAdminMatchSummary | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const firstPlayerView = match.session.getPlayerViewState(match.participants.FIRST.playerId);
    if (!firstPlayerView) {
      return null;
    }

    return {
      matchId: match.matchId,
      startedAt: match.startedAt,
      durationMs: Math.max(0, now - match.startedAt),
      updatedAt: match.updatedAt,
      lastActivityAt: match.lastActivityAt,
      seq: match.remoteRevision,
      turnCount: firstPlayerView.match.turnCount,
      phase: firstPlayerView.match.phase,
      subPhase: firstPlayerView.match.subPhase,
      activeSeat: firstPlayerView.match.activeSeat,
    };
  }

  getMatchSnapshot(matchId: string, userId: string): Promise<OnlineMatchSnapshot | null>;
  getMatchSnapshot(
    matchId: string,
    userId: string,
    options: { readonly sinceSeq?: number }
  ): Promise<OnlineMatchSnapshotResponse | null>;
  async getMatchSnapshot(
    matchId: string,
    userId: string,
    options: { readonly sinceSeq?: number } = {}
  ): Promise<OnlineMatchSnapshotResponse | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.getMatchSnapshotInCriticalSection(matchId, userId, options)
    );
  }

  private async getMatchSnapshotInCriticalSection(
    matchId: string,
    userId: string,
    options: { readonly sinceSeq?: number } = {}
  ): Promise<OnlineMatchSnapshotResponse | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expirePendingManualOperationModeRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    touchMatch(match);
    const currentSeq = match.remoteRevision;
    const hasPendingRecoveryNotice = participant.seat === 'FIRST' && match.recoveryNotice !== null;
    if (
      !hasPendingRecoveryNotice &&
      options.sinceSeq !== undefined &&
      options.sinceSeq >= currentSeq
    ) {
      return {
        matchId: match.matchId,
        seq: currentSeq,
        currentPublicSeq: match.session.getCurrentPublicEventSeq(),
        modified: false,
      };
    }

    return this.buildSnapshotForParticipant(match, participant);
  }

  async getMatchPublicEvents(
    matchId: string,
    userId: string,
    options: { readonly afterSeq?: number } = {}
  ): Promise<PublicEventsResponse | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.getMatchPublicEventsInCriticalSection(matchId, userId, options)
    );
  }

  private async getMatchPublicEventsInCriticalSection(
    matchId: string,
    userId: string,
    options: { readonly afterSeq?: number } = {}
  ): Promise<PublicEventsResponse | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expirePendingManualOperationModeRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    touchMatch(match);
    const afterSeq = normalizePublicEventCursor(options.afterSeq);
    return buildPublicEventsResponse(match, afterSeq, 'PARTICIPANT');
  }

  getMatchChatMessages(
    matchId: string,
    userId: string,
    options: { readonly afterSeq?: number } = {}
  ): OnlineMatchChatMessagesResponse | null {
    const match = this.matches.get(matchId);
    if (!match || match.matchMode !== 'ONLINE') {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant || participant.participantKind !== 'USER') {
      return null;
    }

    touchMatch(match);
    return readOnlineMatchChatMessages(match.chat, match.matchId, options.afterSeq);
  }

  sendMatchChatMessage(
    matchId: string,
    userId: string,
    input: SendOnlineMatchChatMessageInput
  ): OnlineMatchChatMessage | null {
    const match = this.matches.get(matchId);
    if (!match || match.matchMode !== 'ONLINE') {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant || participant.participantKind !== 'USER') {
      return null;
    }

    const message = appendOnlineMatchChatMessage(match.chat, participant, input, {
      now: this.now(),
      blockedTerms: this.chatBlockedTerms,
    });
    touchMatch(match);
    return message;
  }

  private buildSnapshotForParticipant(
    match: OnlineMatchState,
    participant: OnlineMatchParticipant,
    options: { readonly undoView?: OnlineUndoView } = {}
  ): OnlineMatchSnapshot {
    const recoveryNotice = participant.seat === 'FIRST' ? match.recoveryNotice : null;
    const recovery = recoveryNotice
      ? {
          restoredAt: recoveryNotice.restoredAt,
          checkpointSeq: recoveryNotice.checkpointSeq,
          checkpointTimelineSeq: recoveryNotice.checkpointTimelineSeq,
          currentPublicSeq: recoveryNotice.currentPublicSeq,
          rolledBackFromPublicSeq: recoveryNotice.rolledBackFromPublicSeq,
          rolledBackFromTimelineSeq: recoveryNotice.rolledBackFromTimelineSeq,
        }
      : undefined;
    const snapshot = buildSnapshot(match, participant, {
      ...options,
      publicEvents: recoveryNotice?.publicEvents,
      truncated: recoveryNotice?.truncated,
      droppedEventCount: recoveryNotice?.droppedEventCount,
      recovery,
    });
    if (recoveryNotice) {
      match.recoveryNotice = null;
    }
    return snapshot;
  }

  async createAdminPlayerViewSpectatorLink(
    matchId: string,
    viewerSeat: Seat
  ): Promise<OnlineSpectatorLinkView | null> {
    const match = this.matches.get(matchId);
    if (!match || match.matchMode !== 'ONLINE' || !match.participants[viewerSeat]) {
      return null;
    }

    return this.createSpectatorLinkForSeat(match, viewerSeat, {
      source: 'ADMIN_LINK',
      countsInPresence: false,
      authorizedViewerSeats: ['FIRST', 'SECOND'],
      roomGeneration: null,
    });
  }

  createRoomCodePlayerViewSpectatorLink(
    matchId: string,
    viewerSeat: Seat,
    authorizedViewerSeats: readonly Seat[],
    roomGeneration: string
  ): OnlineSpectatorLinkView | null {
    const match = this.matches.get(matchId);
    if (!match || match.matchMode !== 'ONLINE' || !match.participants[viewerSeat]) {
      return null;
    }

    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const preferredViewerUserId = match.participants[viewerSeat].userId;
    const existingLink = [...this.spectatorLinks.values()].find(
      (link) =>
        link.source === 'ROOM_CODE' &&
        link.roomCode === match.roomCode &&
        link.roomGeneration === roomGeneration &&
        link.preferredViewerUserId === preferredViewerUserId &&
        link.revokedAt === null &&
        link.expiresAt > now
    );
    if (existingLink) {
      this.attachRoomCodeSpectatorLink(existingLink, match, authorizedViewerSeats);
      if (match) {
        touchMatch(match);
      }
      return buildSpectatorLinkView(existingLink);
    }

    return this.createSpectatorLinkForSeat(match, viewerSeat, {
      source: 'ROOM_CODE',
      countsInPresence: true,
      authorizedViewerSeats,
      roomGeneration,
    });
  }

  setRoomCodeSpectatorSeats(
    matchId: string,
    roomGeneration: string,
    authorizedViewerSeats: readonly Seat[]
  ): void {
    const now = this.now();
    const match = this.matches.get(matchId);
    if (!match) {
      return;
    }
    const nextSeats = normalizeViewerSeats(authorizedViewerSeats);
    const nextUserIds = new Set(nextSeats.map((seat) => match.participants[seat].userId));
    for (const link of this.spectatorLinks.values()) {
      if (
        link.source !== 'ROOM_CODE' ||
        link.roomCode !== match.roomCode ||
        link.roomGeneration !== roomGeneration ||
        link.revokedAt !== null
      ) {
        continue;
      }
      const previousSeats = normalizeViewerSeats(link.authorizedViewerSeats);
      const scopedNextUserIds = [...nextUserIds].filter((userId) =>
        link.knownRoomMemberUserIds.has(userId)
      );
      replaceStringSet(link.authorizedViewerUserIds, scopedNextUserIds);
      const scopedNextSeats = nextSeats.filter((seat) =>
        link.authorizedViewerUserIds.has(match.participants[seat].userId)
      );
      const authorizationChanged =
        previousSeats.length !== scopedNextSeats.length ||
        previousSeats.some((seat, index) => seat !== scopedNextSeats[index]);
      if (!authorizationChanged) {
        continue;
      }
      replaceAuthorizedViewerSeats(link.authorizedViewerSeats, scopedNextSeats);
      const closedSeats = previousSeats.filter((seat) => !link.authorizedViewerSeats.has(seat));
      if (scopedNextSeats.length === 0) {
        link.revokedAt = now;
        link.revokedReason = 'ROOM_CODE_AUTHORIZATION_CLOSED';
      } else {
        const preferredLinkSeat = findSeatByUserId(match, link.preferredViewerUserId);
        link.viewerSeat =
          preferredLinkSeat && link.authorizedViewerSeats.has(preferredLinkSeat)
            ? preferredLinkSeat
            : scopedNextSeats[0];
      }
      for (const session of this.spectatorSessions.values()) {
        if (session.token !== link.token) {
          continue;
        }
        replaceStringSet(session.authorizedViewerUserIds, link.authorizedViewerUserIds);
        replaceAuthorizedViewerSeats(session.authorizedViewerSeats, scopedNextSeats);
        if (scopedNextSeats.length === 0) {
          endSpectatorSession(session, 'AUTHORIZATION_CLOSED', now);
          continue;
        }
        const preferredSeat = findSeatByUserId(match, session.preferredViewerUserId);
        const previousViewerSeat = session.viewerSeat;
        const nextViewerSeat =
          preferredSeat && link.authorizedViewerSeats.has(preferredSeat)
            ? preferredSeat
            : previousViewerSeat && link.authorizedViewerSeats.has(previousViewerSeat)
              ? previousViewerSeat
              : scopedNextSeats[0];
        const autoSwitched = previousViewerSeat !== nextViewerSeat;
        session.viewVersion += 1;
        session.viewerSeat = nextViewerSeat;
        session.effectiveViewerUserId = match.participants[nextViewerSeat].userId;
        session.effectiveViewerDisplayName = match.participants[nextViewerSeat].displayName;
        if (closedSeats.length > 0) {
          session.authorizationNotice = {
            code: 'VIEW_AUTHORIZATION_CLOSED',
            closedViewerSeats: closedSeats,
            autoSwitched,
            message: buildSpectatorAuthorizationClosedMessage(closedSeats, autoSwitched),
          };
        } else {
          session.authorizationNotice = null;
        }
      }
    }

    touchMatch(match);
  }

  private createSpectatorLinkForSeat(
    match: OnlineMatchState,
    viewerSeat: Seat,
    options: {
      readonly source: OnlineSpectatorLinkState['source'];
      readonly countsInPresence: boolean;
      readonly authorizedViewerSeats: readonly Seat[];
      readonly roomGeneration: string | null;
    }
  ): OnlineSpectatorLinkView {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const authorizedViewerSeats = normalizeViewerSeats(options.authorizedViewerSeats);
    if (!authorizedViewerSeats.includes(viewerSeat)) {
      authorizedViewerSeats.unshift(viewerSeat);
    }
    const preferredParticipant = match.participants[viewerSeat];
    const knownRoomMemberUserIds = new Set(
      options.source === 'ROOM_CODE'
        ? [match.participants.FIRST.userId, match.participants.SECOND.userId]
        : []
    );
    const authorizedViewerUserIds = new Set(
      options.source === 'ROOM_CODE'
        ? authorizedViewerSeats.map((seat) => match.participants[seat].userId)
        : []
    );
    const link: OnlineSpectatorLinkState = {
      token: this.idGenerator(),
      matchId: match.matchId,
      roomCode: match.roomCode,
      roomGeneration: options.roomGeneration,
      attachmentGeneration: 1,
      viewType: 'PLAYER',
      viewerSeat,
      authorizedViewerSeats: new Set(authorizedViewerSeats),
      knownRoomMemberUserIds,
      authorizedViewerUserIds,
      preferredViewerUserId: options.source === 'ROOM_CODE' ? preferredParticipant.userId : null,
      preferredViewerDisplayName:
        options.source === 'ROOM_CODE' ? preferredParticipant.displayName : null,
      source: options.source,
      countsInPresence: options.countsInPresence,
      createdAt: now,
      expiresAt: now + SPECTATOR_LINK_TTL_MS,
      revokedAt: null,
      revokedReason: null,
    };
    this.spectatorLinks.set(link.token, link);
    touchMatch(match);

    return buildSpectatorLinkView(link);
  }

  async joinSpectatorLink(
    tokenInput: string,
    input: {
      readonly displayName?: string | null;
      readonly clientId?: string | null;
      readonly authenticatedUserId?: string | null;
    } = {}
  ): Promise<OnlineSpectatorJoinView> {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    if (
      link.source === 'ROOM_CODE' &&
      input.authenticatedUserId &&
      link.knownRoomMemberUserIds.has(input.authenticatedUserId)
    ) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_ROOM_SPECTATOR_FORBIDDEN',
        '当前账号不能通过房间号进入该观战入口',
        403
      );
    }
    const clientId = normalizeSpectatorClientId(input.clientId);
    const displayName = normalizeSpectatorDisplayName(input.displayName);
    const existingSession = clientId
      ? this.findActiveSpectatorSessionByClientId(link.token, clientId, now)
      : null;

    if (existingSession) {
      this.consumeSpectatorRequest(existingSession, now);
      existingSession.lastSeenAt = now;
      if (displayName) {
        existingSession.displayName = displayName;
      }
      if (match) {
        touchMatch(match);
      }

      return {
        link: buildSpectatorLinkView(link),
        session: buildSpectatorSessionView(existingSession),
        snapshot: this.buildSpectatorSyncState(match, link, existingSession),
      };
    }

    if (!match) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_WAITING_SESSION_REQUIRED',
        '该房间正在准备下一局，只有原观战会话可以继续等待',
        409
      );
    }

    if (
      link.countsInPresence &&
      this.countActivePublicSpectatorSessionsForRoom(link.roomCode, link.roomGeneration, now) >=
        this.spectatorMaxPublicSessions
    ) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_CAPACITY_REACHED',
        `该房间观战人数已达上限（${this.spectatorMaxPublicSessions} 人），请稍后再进入`,
        429
      );
    }

    const viewerSeat =
      link.viewerSeat && link.authorizedViewerSeats.has(link.viewerSeat)
        ? link.viewerSeat
        : normalizeViewerSeats(link.authorizedViewerSeats)[0];
    if (!viewerSeat) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_VIEW_FORBIDDEN',
        '当前没有可用的观战视角',
        403
      );
    }

    const session: OnlineSpectatorSessionState = {
      sessionId: this.idGenerator(),
      token: link.token,
      clientId,
      matchId: link.matchId,
      roomCode: link.roomCode,
      roomGeneration: link.roomGeneration,
      attachmentGeneration: link.attachmentGeneration,
      previousMatchId: null,
      viewType: link.viewType,
      viewerSeat,
      authorizedViewerSeats: link.authorizedViewerSeats,
      authorizedViewerUserIds: new Set(link.authorizedViewerUserIds),
      preferredViewerUserId:
        link.source === 'ROOM_CODE'
          ? link.preferredViewerUserId
          : match.participants[viewerSeat].userId,
      preferredViewerDisplayName:
        link.source === 'ROOM_CODE'
          ? link.preferredViewerDisplayName
          : match.participants[viewerSeat].displayName,
      effectiveViewerUserId: match.participants[viewerSeat].userId,
      effectiveViewerDisplayName: match.participants[viewerSeat].displayName,
      viewVersion: 1,
      authorizationNotice: null,
      countsInPresence: link.countsInPresence,
      displayName: displayName ?? this.createGuestDisplayName(match.matchId, now),
      joinedAt: now,
      lastSeenAt: now,
      endedAt: null,
      endReason: null,
    };
    this.spectatorSessions.set(session.sessionId, session);
    touchMatch(match);

    return {
      link: buildSpectatorLinkView(link),
      session: buildSpectatorSessionView(session),
      snapshot: this.buildSpectatorSyncState(match, link, session),
    };
  }

  async getSpectatorSnapshot(
    tokenInput: string,
    sessionId: string | null | undefined,
    options: {
      readonly sinceSeq?: number;
      readonly sinceViewVersion?: number;
      readonly expectedRoomGeneration?: string;
      readonly expectedAttachmentGeneration?: number;
    } = {}
  ): Promise<OnlineSpectatorSnapshotResponse> {
    const token = normalizeSpectatorToken(tokenInput);
    const matchId = token ? this.spectatorLinks.get(token)?.matchId : null;
    if (!matchId) {
      return this.getSpectatorSnapshotInCriticalSection(tokenInput, sessionId, options, null);
    }
    return this.serialExecutor.runExclusive(matchId, () =>
      this.getSpectatorSnapshotInCriticalSection(tokenInput, sessionId, options, matchId)
    );
  }

  private async getSpectatorSnapshotInCriticalSection(
    tokenInput: string,
    sessionId: string | null | undefined,
    options: {
      readonly sinceSeq?: number;
      readonly sinceViewVersion?: number;
      readonly expectedRoomGeneration?: string;
      readonly expectedAttachmentGeneration?: number;
    } = {},
    lockedMatchId: string | null
  ): Promise<OnlineSpectatorSnapshotResponse> {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    this.assertSpectatorMatchLock(link, lockedMatchId);
    const session = this.requireActiveSpectatorSession(link, sessionId, now);
    this.consumeSpectatorRequest(session, now);
    this.assertSpectatorGenerationExpectations(link, session, options.expectedRoomGeneration);

    if (!match) {
      return buildSpectatorWaitingView(link, session);
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expirePendingManualOperationModeRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    touchMatch(match);

    const currentSeq = match.remoteRevision;
    if (
      options.sinceSeq !== undefined &&
      options.sinceSeq >= currentSeq &&
      options.sinceViewVersion === session.viewVersion &&
      (options.expectedAttachmentGeneration === undefined ||
        options.expectedAttachmentGeneration === session.attachmentGeneration)
    ) {
      return {
        matchId: match.matchId,
        seq: currentSeq,
        currentPublicSeq: match.session.getCurrentPublicEventSeq(),
        modified: false,
        spectatorView: buildSpectatorViewState(link, session),
      };
    }

    return buildReadonlySpectatorSnapshot(match, link, session);
  }

  async switchSpectatorView(
    tokenInput: string,
    sessionId: string | null | undefined,
    viewerSeat: Seat
  ): Promise<OnlineSpectatorSwitchView> {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    const session = this.requireActiveSpectatorSession(link, sessionId, now);
    this.consumeSpectatorRequest(session, now);
    if (!match) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_VIEW_SWITCH_UNAVAILABLE',
        '正在准备下一局，暂时不能切换观战目标',
        409
      );
    }
    if (!link.authorizedViewerSeats.has(viewerSeat)) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_VIEW_FORBIDDEN',
        '该观战视角未获授权或已被收回',
        403
      );
    }

    session.viewerSeat = viewerSeat;
    session.preferredViewerUserId = match.participants[viewerSeat].userId;
    session.preferredViewerDisplayName = match.participants[viewerSeat].displayName;
    session.effectiveViewerUserId = match.participants[viewerSeat].userId;
    session.effectiveViewerDisplayName = match.participants[viewerSeat].displayName;
    session.viewVersion += 1;
    session.authorizationNotice = null;
    session.lastSeenAt = now;
    touchMatch(match);
    return {
      session: buildSpectatorSessionView(session),
      snapshot: buildReadonlySpectatorSnapshot(match, link, session),
    };
  }

  async getSpectatorPublicEvents(
    tokenInput: string,
    sessionId: string | null | undefined,
    options: {
      readonly afterSeq?: number;
      readonly expectedRoomGeneration?: string;
      readonly expectedAttachmentGeneration?: number;
    } = {}
  ): Promise<PublicEventsResponse> {
    const token = normalizeSpectatorToken(tokenInput);
    const matchId = token ? this.spectatorLinks.get(token)?.matchId : null;
    if (!matchId) {
      return this.getSpectatorPublicEventsInCriticalSection(tokenInput, sessionId, options, null);
    }
    return this.serialExecutor.runExclusive(matchId, () =>
      this.getSpectatorPublicEventsInCriticalSection(tokenInput, sessionId, options, matchId)
    );
  }

  private async getSpectatorPublicEventsInCriticalSection(
    tokenInput: string,
    sessionId: string | null | undefined,
    options: {
      readonly afterSeq?: number;
      readonly expectedRoomGeneration?: string;
      readonly expectedAttachmentGeneration?: number;
    } = {},
    lockedMatchId: string | null
  ): Promise<PublicEventsResponse> {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    this.assertSpectatorMatchLock(link, lockedMatchId);
    const session = this.requireActiveSpectatorSession(link, sessionId, now);
    this.consumeSpectatorRequest(session, now);
    this.assertSpectatorGenerationExpectations(link, session, options.expectedRoomGeneration);
    if (
      options.expectedAttachmentGeneration !== undefined &&
      options.expectedAttachmentGeneration !== session.attachmentGeneration
    ) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_BINDING_CHANGED',
        '观战对局已经切换，请先同步新的房间状态',
        409
      );
    }
    if (!match) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_WAITING_NEXT_MATCH',
        '房间正在准备下一局，当前没有可读取的单局公开日志',
        409
      );
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expirePendingManualOperationModeRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    touchMatch(match);
    const afterSeq = normalizePublicEventCursor(options.afterSeq);
    return buildPublicEventsResponse(match, afterSeq, 'SPECTATOR');
  }

  getSpectatorChatMessages(
    tokenInput: string,
    sessionId: string | null | undefined,
    options: {
      readonly afterSeq?: number;
      readonly expectedRoomGeneration?: string;
      readonly expectedAttachmentGeneration?: number;
    } = {}
  ): OnlineMatchChatMessagesResponse {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    const session = this.requireActiveSpectatorSession(link, sessionId, now);
    this.consumeSpectatorRequest(session, now);
    this.assertSpectatorGenerationExpectations(link, session, options.expectedRoomGeneration);
    if (
      options.expectedAttachmentGeneration !== undefined &&
      options.expectedAttachmentGeneration !== session.attachmentGeneration
    ) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_BINDING_CHANGED',
        '观战对局已经切换，请先同步新的房间状态',
        409
      );
    }
    if (!match || match.matchMode !== 'ONLINE') {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_WAITING_NEXT_MATCH',
        '房间正在准备下一局，当前没有可读取的单局聊天',
        409
      );
    }

    touchMatch(match);
    return readOnlineMatchChatMessages(match.chat, match.matchId, options.afterSeq);
  }

  private assertSpectatorGenerationExpectations(
    link: OnlineSpectatorLinkState,
    _session: OnlineSpectatorSessionState,
    expectedRoomGeneration: string | undefined
  ): void {
    if (expectedRoomGeneration !== undefined && expectedRoomGeneration !== link.roomGeneration) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_ROOM_REPLACED',
        '原房间已失效，相同房间号的新房间不会继承本次观战资格',
        410
      );
    }
  }

  private assertSpectatorMatchLock(
    link: OnlineSpectatorLinkState,
    lockedMatchId: string | null
  ): void {
    if (lockedMatchId !== null && link.matchId !== lockedMatchId) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_BINDING_CHANGED',
        '观战对局已经切换，请重新同步',
        409
      );
    }
  }

  getSpectatorPresenceForMatch(matchId: string): OnlineSpectatorPresenceView {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const viewers = [...this.spectatorSessions.values()]
      .filter((session) => session.matchId === matchId)
      .filter((session) => session.countsInPresence)
      .filter((session) => isSpectatorSessionActive(session, now))
      .sort(
        (left, right) =>
          left.joinedAt - right.joinedAt || left.sessionId.localeCompare(right.sessionId)
      )
      .map(buildSpectatorSessionView);

    return {
      total: viewers.length,
      viewers,
    };
  }

  getRoomCodeSpectatorPresence(
    roomCode: string,
    roomGeneration: string
  ): OnlineSpectatorPresenceView {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const viewers = [...this.spectatorSessions.values()]
      .filter(
        (session) =>
          session.roomCode === roomCode &&
          session.roomGeneration === roomGeneration &&
          session.countsInPresence &&
          isSpectatorSessionActive(session, now)
      )
      .sort(
        (left, right) =>
          left.joinedAt - right.joinedAt || left.sessionId.localeCompare(right.sessionId)
      )
      .map(buildSpectatorSessionView);
    return { total: viewers.length, viewers };
  }

  private buildSpectatorSyncState(
    match: OnlineMatchState | null,
    link: OnlineSpectatorLinkState,
    session: OnlineSpectatorSessionState
  ): OnlineSpectatorMatchSnapshot | OnlineSpectatorWaitingView {
    return match
      ? buildReadonlySpectatorSnapshot(match, link, session)
      : buildSpectatorWaitingView(link, session);
  }

  async executeCommand(
    matchId: string,
    userId: string,
    command: GameCommand
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.executeCommandInCriticalSection(matchId, userId, command)
    );
  }

  private async executeCommandInCriticalSection(
    matchId: string,
    userId: string,
    command: GameCommand,
    options: {
      readonly trustedSystemSubmission?: boolean;
      readonly strategySubmission?: MachineStrategySubmissionMetadata;
    } = {}
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }
    if (participant.participantKind === 'SYSTEM' && !options.trustedSystemSubmission) {
      return {
        success: false,
        error: 'SYSTEM 参赛者只能通过服务端内部授权边界提交命令',
      };
    }

    const commandWithPlayer = applyAuthoritativeManualOperationModeToCommand(
      { ...command, playerId: participant.playerId },
      match.session.manualOperationMode
    );
    const shouldBuildDecisionRecords = shouldBuildDecisionRecordsForCommand(commandWithPlayer);
    const beforeState = shouldBuildDecisionRecords
      ? match.session.getAuthoritySnapshotForRecord()
      : null;
    const ruleRandomFactCountBefore = match.session.getRuleRandomFacts().length;
    const result =
      commandWithPlayer.type === GameCommandType.SYSTEM_CONCEDE
        ? participant.participantKind === 'SYSTEM'
          ? match.session.executeSystemConcession(commandWithPlayer)
          : {
              success: false,
              gameState: match.session.state!,
              error: 'SYSTEM 认输只能由 SYSTEM 参赛者执行',
            }
        : match.session.executeCommand(commandWithPlayer);
    const afterState =
      shouldBuildDecisionRecords && result.success
        ? match.session.getAuthoritySnapshotForRecord()
        : null;
    const submittedCommandSeq = latestSeq(
      match.session.getCommandLogSince(0),
      (record) => record.seq
    );
    const decisionRecords = buildMatchDecisionRecordsForCommand({
      matchId: match.matchId,
      beforeState,
      afterState,
      command: commandWithPlayer,
      commandSucceeded: result.success,
      submittedCommandSeq,
      getSeatForPlayer: (playerId) => getSeatByPlayerId(match, playerId),
    });

    touchMatch(match);
    if (result.success) {
      this.incrementAuthorityRevision(match);
    }
    const strategyDecisionRecord = options.strategySubmission
      ? createAiStrategyDecisionRecord({
          decisionAudit: options.strategySubmission.audit,
          decisionId: options.strategySubmission.decisionId,
          windowSignature: options.strategySubmission.windowSignature,
          commandType: commandWithPlayer.type,
          authorityRevisionAfter: match.remoteRevision,
          execution: result.success
            ? { status: 'ACCEPTED' }
            : { status: 'REJECTED', errorCode: result.error ?? 'UNKNOWN_COMMAND_REJECTION' },
          modelInvocation: options.strategySubmission.modelInvocation,
          ruleRandomFactRefs: match.session
            .getRuleRandomFacts()
            .slice(ruleRandomFactCountBefore)
            .map((fact) => `rule-random-fact-${String(fact.sequence)}`),
        })
      : null;
    const allDecisionRecords = strategyDecisionRecord
      ? [...decisionRecords, buildAiStrategyMatchDecisionRecord(strategyDecisionRecord)]
      : decisionRecords;
    await this.appendSessionRecordFrame(
      match,
      result.success ? 'COMMAND_ACCEPTED' : 'COMMAND_REJECTED',
      {
        command: commandWithPlayer,
        authorityState: afterState,
        decisionRecords: allDecisionRecords,
      }
    );
    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    if (match.pendingUndoRequest) {
      await this.expirePendingUndoRequest(match, '新命令已执行，撤销请求失效');
    }
    if (match.pendingManualOperationModeRequest) {
      await this.expirePendingManualOperationModeRequest(match, '新操作已执行，自由模式请求失效');
    }
    if (match.activeUndoGrant) {
      await this.expireActiveUndoGrant(match, '新命令已执行，连续撤销授权失效');
    }

    await this.sealCompletedMatchIfNeeded(match);

    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async advancePhase(matchId: string, userId: string): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.advancePhaseInCriticalSection(matchId, userId)
    );
  }

  private async advancePhaseInCriticalSection(
    matchId: string,
    userId: string
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    if (!match.session.isActivePlayer(participant.playerId)) {
      touchMatch(match);
      const rejectedAttemptSeq = ++this.serviceRejectedAttemptSeq;
      await this.appendSessionRecordFrame(match, 'COMMAND_REJECTED', {
        summary: '服务层拒绝阶段推进：当前不是该玩家的推进时机',
        force: true,
        writeAuthorityCheckpoint: false,
        dedupeKey: `service-rejected:advance-phase:${participant.seat}:${rejectedAttemptSeq}`,
      });
      return {
        success: false,
        error: '当前不是该玩家的推进时机',
      };
    }

    const state = match.session.state;
    if (!state) {
      return { success: false, error: '对局尚未开始' };
    }
    const command =
      state.currentPhase === GamePhase.MAIN_PHASE && state.currentSubPhase === SubPhase.NONE
        ? createEndPhaseCommand(participant.playerId)
        : createConfirmStepCommand(participant.playerId, state.currentSubPhase);
    return this.executeCommandInCriticalSection(matchId, userId, command);
  }

  getUndoAvailability(matchId: string, userId: string, policy?: UndoPolicy): OnlineUndoView | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    return match.session.getUndoAvailability(
      participant.playerId,
      policy ?? deriveRemoteUndoPolicy(match, participant)
    );
  }

  async undoLatest(
    matchId: string,
    userId: string,
    input: RemoteUndoInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.undoLatestInCriticalSection(matchId, userId, input)
    );
  }

  private async undoLatestInCriticalSection(
    matchId: string,
    userId: string,
    input: RemoteUndoInput
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const appliedUndoKey = idempotencyKey ? `${input.undoEntryId}:${idempotencyKey}` : null;
    if (appliedUndoKey && match.appliedUndoKeys.has(appliedUndoKey)) {
      touchMatch(match);
      return {
        success: true,
        snapshot: this.buildSnapshotForParticipant(match, participant),
      };
    }

    if (input.expectedRevision !== match.remoteRevision) {
      touchMatch(match);
      return {
        success: false,
        error: '对局状态已更新，请刷新后重试',
      };
    }

    const policy = deriveRemoteUndoPolicy(match, participant);
    const availability = match.session.getUndoAvailability(participant.playerId, policy);
    if (!availability.canUndoNow || !availability.entry) {
      touchMatch(match);
      return {
        success: false,
        error: availability.disabledReason ?? '当前不能撤销',
      };
    }
    if (availability.entry.undoEntryId !== input.undoEntryId) {
      touchMatch(match);
      return {
        success: false,
        error: '撤销目标已变化，请刷新后重试',
      };
    }
    if (policy === 'REMOTE_REQUEST') {
      if (match.pendingUndoRequest) {
        touchMatch(match);
        return {
          success: false,
          error: '已有撤销请求待处理',
        };
      }
      if (!getUsableUndoGrant(match, participant, availability.entry)) {
        touchMatch(match);
        return {
          success: false,
          error: '正式联机需要对手同意后才能撤销',
        };
      }
    }

    const undoResult = match.session.undoLastStepForPlayer(participant.playerId, input.undoEntryId);
    if (!undoResult.success) {
      touchMatch(match);
      return {
        success: false,
        error: undoResult.error,
      };
    }

    match.recordBranchId = `${match.matchId}:branch:${match.remoteRevision + 1}`;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'UNDO_APPLIED', {
      summary: `撤销操作：${availability.entry.label}`,
      force: true,
      writeAuthorityCheckpoint: true,
      dedupeKey:
        appliedUndoKey ??
        `${match.recordBranchId}:UNDO_APPLIED:${availability.entry.undoEntryId}:${match.remoteRevision}`,
    });
    match.recordCaptureCursor = match.session.getRuntimeCaptureCursor();
    if (appliedUndoKey) {
      match.appliedUndoKeys.add(appliedUndoKey);
    }
    await this.expireActiveUndoGrantIfNoLongerUsable(match);

    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async createUndoRequest(
    matchId: string,
    userId: string,
    input: CreateUndoRequestInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.createUndoRequestInCriticalSection(matchId, userId, input)
    );
  }

  private async createUndoRequestInCriticalSection(
    matchId: string,
    userId: string,
    input: CreateUndoRequestInput
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    if (
      idempotencyKey &&
      match.pendingUndoRequest?.idempotencyKey === idempotencyKey &&
      match.pendingUndoRequest.requesterUserId === participant.userId &&
      match.pendingUndoRequest.targetUndoEntryId === input.undoEntryId
    ) {
      touchMatch(match);
      return {
        success: true,
        snapshot: this.buildSnapshotForParticipant(match, participant),
      };
    }

    if (deriveRemoteUndoPolicy(match, participant) !== 'REMOTE_REQUEST') {
      touchMatch(match);
      return {
        success: false,
        error: '当前对局不支持请求撤销',
      };
    }
    if (input.expectedRevision !== match.remoteRevision) {
      touchMatch(match);
      return {
        success: false,
        error: '对局状态已更新，请刷新后重试',
      };
    }
    if (match.pendingUndoRequest) {
      touchMatch(match);
      return {
        success: false,
        error: '已有撤销请求待处理',
      };
    }
    if (match.pendingManualOperationModeRequest) {
      touchMatch(match);
      return {
        success: false,
        error: '请先处理当前自由模式请求',
      };
    }

    const availability = match.session.getUndoAvailability(participant.playerId, 'REMOTE_REQUEST');
    if (!availability.canUndoNow || !availability.entry) {
      touchMatch(match);
      return {
        success: false,
        error: availability.disabledReason ?? '当前不能请求撤销',
      };
    }
    if (availability.entry.undoEntryId !== input.undoEntryId) {
      touchMatch(match);
      return {
        success: false,
        error: '撤销目标已变化，请刷新后重试',
      };
    }
    if (getUsableUndoGrant(match, participant, availability.entry)) {
      touchMatch(match);
      return {
        success: false,
        error: '已有连续撤销授权，可直接撤销',
      };
    }

    const responderSeat = getOpponentSeat(participant.seat);
    const responder = match.participants[responderSeat];
    const now = this.now();
    match.pendingUndoRequest = {
      requestId: `${match.matchId}:undo-request:${match.remoteRevision + 1}`,
      requesterSeat: participant.seat,
      responderSeat,
      requesterUserId: participant.userId,
      responderUserId: responder.userId,
      targetUndoEntryId: availability.entry.undoEntryId,
      targetRevision: match.remoteRevision,
      summary: availability.entry.label,
      createdAt: now,
      expiresAt: now + UNDO_REQUEST_TTL_MS,
      idempotencyKey,
    };

    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'UNDO_REQUESTED', {
      summary: `请求撤销：${availability.entry.label}`,
      force: true,
      writeAuthorityCheckpoint: false,
      dedupeKey: `${match.recordBranchId}:UNDO_REQUESTED:${match.pendingUndoRequest.requestId}`,
    });

    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async acceptUndoRequest(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondUndoRequestInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.acceptUndoRequestInCriticalSection(matchId, userId, requestId, input)
    );
  }

  private async acceptUndoRequestInCriticalSection(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondUndoRequestInput
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const acceptedUndoKey = idempotencyKey
      ? buildUndoRequestSettlementKey('accept', requestId, participant.userId, idempotencyKey)
      : null;
    if (acceptedUndoKey && match.appliedUndoKeys.has(acceptedUndoKey)) {
      touchMatch(match);
      return {
        success: true,
        snapshot: this.buildSnapshotForParticipant(match, participant),
      };
    }

    const request = match.pendingUndoRequest;
    if (!request || request.requestId !== requestId) {
      touchMatch(match);
      return {
        success: false,
        error: '撤销请求不存在或已失效',
      };
    }
    if (request.responderSeat !== participant.seat) {
      touchMatch(match);
      return {
        success: false,
        error: '只有对手可以处理撤销请求',
      };
    }
    if (input.expectedRevision !== match.remoteRevision) {
      touchMatch(match);
      return {
        success: false,
        error: '对局状态已更新，请刷新后重试',
      };
    }

    const requester = match.participants[request.requesterSeat];
    const availability = match.session.getUndoAvailability(requester.playerId, 'REMOTE_REQUEST');
    if (!availability.canUndoNow || availability.entry?.undoEntryId !== request.targetUndoEntryId) {
      await this.expirePendingUndoRequest(match, '撤销目标已变化，请重新发起');
      return {
        success: false,
        error: '撤销目标已变化，请重新发起',
      };
    }

    const undoResult = match.session.undoLastStepForPlayer(
      requester.playerId,
      request.targetUndoEntryId
    );
    if (!undoResult.success) {
      touchMatch(match);
      return {
        success: false,
        error: undoResult.error,
      };
    }

    match.pendingUndoRequest = null;
    match.activeUndoGrant = null;
    if (input.grantContinuous) {
      const nextAvailability = match.session.getUndoAvailability(
        requester.playerId,
        'REMOTE_REQUEST'
      );
      if (
        nextAvailability.canUndoNow &&
        nextAvailability.entry?.boundaryKey === availability.entry.boundaryKey
      ) {
        const now = this.now();
        match.activeUndoGrant = {
          grantId: `${request.requestId}:continuous`,
          requesterSeat: request.requesterSeat,
          requesterUserId: request.requesterUserId,
          grantorSeat: request.responderSeat,
          grantorUserId: request.responderUserId,
          boundaryKey: availability.entry.boundaryKey,
          createdAt: now,
          expiresAt: now + UNDO_REQUEST_TTL_MS,
        };
      }
    }
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    // 接受请求这个记录事实仍属于原 recordBranch；权威状态已在上方回滚。
    // 本帧不写 checkpoint，下面的 UNDO_APPLIED 才开启回滚后的新记录分支。
    await this.appendSessionRecordFrame(match, 'UNDO_ACCEPTED', {
      summary: input.grantContinuous
        ? `接受撤销请求并允许连续撤销：${request.summary}`
        : `接受撤销请求：${request.summary}`,
      force: true,
      writeAuthorityCheckpoint: false,
      dedupeKey: `${match.recordBranchId}:UNDO_ACCEPTED:${request.requestId}:${match.remoteRevision}`,
    });

    match.recordBranchId = `${match.matchId}:branch:${match.remoteRevision + 1}`;
    this.incrementAuthorityRevision(match);
    await this.appendSessionRecordFrame(match, 'UNDO_APPLIED', {
      summary: `撤销操作：${request.summary}`,
      force: true,
      writeAuthorityCheckpoint: true,
      dedupeKey: `${match.recordBranchId}:UNDO_APPLIED:${request.requestId}:${
        idempotencyKey ?? match.remoteRevision
      }`,
    });
    match.recordCaptureCursor = match.session.getRuntimeCaptureCursor();
    if (acceptedUndoKey) {
      match.appliedUndoKeys.add(acceptedUndoKey);
    }

    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async rejectUndoRequest(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondUndoRequestInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.rejectUndoRequestInCriticalSection(matchId, userId, requestId, input)
    );
  }

  private async rejectUndoRequestInCriticalSection(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondUndoRequestInput
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const rejectedUndoKey = idempotencyKey
      ? buildUndoRequestSettlementKey('reject', requestId, participant.userId, idempotencyKey)
      : null;
    if (rejectedUndoKey && match.appliedUndoKeys.has(rejectedUndoKey)) {
      touchMatch(match);
      return {
        success: true,
        snapshot: this.buildSnapshotForParticipant(match, participant),
      };
    }

    const request = match.pendingUndoRequest;
    if (!request || request.requestId !== requestId) {
      touchMatch(match);
      return {
        success: false,
        error: '撤销请求不存在或已失效',
      };
    }
    if (request.responderSeat !== participant.seat) {
      touchMatch(match);
      return {
        success: false,
        error: '只有对手可以处理撤销请求',
      };
    }
    if (input.expectedRevision !== match.remoteRevision) {
      touchMatch(match);
      return {
        success: false,
        error: '对局状态已更新，请刷新后重试',
      };
    }

    match.pendingUndoRequest = null;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'UNDO_REJECTED', {
      summary: `拒绝撤销请求：${request.summary}`,
      force: true,
      writeAuthorityCheckpoint: false,
      dedupeKey: `${match.recordBranchId}:UNDO_REJECTED:${request.requestId}:${match.remoteRevision}`,
    });
    if (rejectedUndoKey) {
      match.appliedUndoKeys.add(rejectedUndoKey);
    }

    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async changeManualOperationMode(
    matchId: string,
    userId: string,
    input: ChangeManualOperationModeInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.changeManualOperationModeInCriticalSection(matchId, userId, input)
    );
  }

  private async changeManualOperationModeInCriticalSection(
    matchId: string,
    userId: string,
    input: ChangeManualOperationModeInput
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }
    const participant = getParticipantByUserId(match, userId);
    if (!participant || participant.participantKind !== 'USER') {
      return null;
    }
    if (hasFormalAiOpponent(match, participant)) {
      touchMatch(match);
      return { success: false, error: 'AI 对战固定使用规则模式，不能切换自由模式' };
    }

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expirePendingManualOperationModeRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const operationKey = buildManualOperationIdempotencyKey(participant.userId, idempotencyKey);
    const operationSignature = `CHANGE:${input.targetMode}`;
    const idempotencyStatus = readManualOperationIdempotencyStatus(
      match,
      operationKey,
      operationSignature
    );
    if (idempotencyStatus === 'MATCH') {
      touchMatch(match);
      return { success: true, snapshot: this.buildSnapshotForParticipant(match, participant) };
    }
    if (idempotencyStatus === 'CONFLICT') {
      touchMatch(match);
      return { success: false, error: '重复请求的操作模式参数不一致' };
    }
    const pendingRequest = match.pendingManualOperationModeRequest;
    if (
      input.targetMode === 'FREE' &&
      idempotencyKey &&
      pendingRequest?.idempotencyKey === idempotencyKey &&
      pendingRequest.requesterUserId === participant.userId
    ) {
      touchMatch(match);
      return {
        success: true,
        snapshot: this.buildSnapshotForParticipant(match, participant),
      };
    }

    if (input.expectedRevision !== match.remoteRevision) {
      touchMatch(match);
      return { success: false, error: '对局状态已更新，请刷新后重试' };
    }
    if (match.pendingUndoRequest) {
      touchMatch(match);
      return { success: false, error: '请先处理当前撤销请求' };
    }

    const currentMode = match.session.manualOperationMode;
    if (currentMode === input.targetMode && !pendingRequest) {
      recordManualOperationIdempotency(match, operationKey, operationSignature);
      touchMatch(match);
      return {
        success: true,
        snapshot: this.buildSnapshotForParticipant(match, participant),
      };
    }

    const blockedReason = match.session.getManualOperationModeSwitchBlockedReason();
    if (blockedReason) {
      touchMatch(match);
      return { success: false, error: blockedReason };
    }

    if (match.matchMode === 'ONLINE' && input.targetMode === 'FREE') {
      if (pendingRequest) {
        touchMatch(match);
        return { success: false, error: '已有自由模式请求待处理' };
      }
      const responderSeat = getOpponentSeat(participant.seat);
      const responder = match.participants[responderSeat];
      const now = this.now();
      match.pendingManualOperationModeRequest = {
        requestId: `${match.matchId}:manual-mode-request:${match.remoteRevision + 1}`,
        requesterSeat: participant.seat,
        responderSeat,
        requesterUserId: participant.userId,
        responderUserId: responder.userId,
        targetMode: 'FREE',
        targetRevision: match.remoteRevision,
        createdAt: now,
        expiresAt: now + MANUAL_OPERATION_MODE_REQUEST_TTL_MS,
        idempotencyKey,
      };
      match.activeUndoGrant = null;
      this.incrementAuthorityRevision(match);
      touchMatch(match);
      await this.appendSessionRecordFrame(match, 'SYSTEM_TRANSITION', {
        summary: `${participant.displayName} 请求开启自由模式`,
        force: true,
        writeAuthorityCheckpoint: false,
        dedupeKey: `${match.recordBranchId}:MANUAL_MODE_REQUESTED:${match.pendingManualOperationModeRequest.requestId}`,
      });
      recordManualOperationIdempotency(match, operationKey, operationSignature);
      return {
        success: true,
        snapshot: this.buildSnapshotForParticipant(match, participant),
      };
    }

    if (pendingRequest) {
      touchMatch(match);
      return { success: false, error: '已有自由模式请求待处理' };
    }
    const result = match.session.setManualOperationMode(input.targetMode);
    if (!result.success) {
      touchMatch(match);
      return { success: false, error: result.error };
    }
    match.activeUndoGrant = null;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'SYSTEM_TRANSITION', {
      summary: input.targetMode === 'FREE' ? '已切换为自由模式' : '已切换为规则模式',
      force: true,
      writeAuthorityCheckpoint: true,
      dedupeKey: `${match.recordBranchId}:MANUAL_MODE_CHANGED:${input.targetMode}:${match.remoteRevision}:${idempotencyKey ?? participant.userId}`,
    });
    recordManualOperationIdempotency(match, operationKey, operationSignature);
    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async acceptManualOperationModeRequest(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondManualOperationModeRequestInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.acceptManualOperationModeRequestInCriticalSection(matchId, userId, requestId, input)
    );
  }

  private async acceptManualOperationModeRequestInCriticalSection(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondManualOperationModeRequestInput
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }
    const participant = getParticipantByUserId(match, userId);
    if (!participant || participant.participantKind !== 'USER') {
      return null;
    }

    await this.expirePendingManualOperationModeRequestIfNeeded(match);
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const operationKey = buildManualOperationIdempotencyKey(participant.userId, idempotencyKey);
    const operationSignature = `ACCEPT:${requestId}`;
    const idempotencyStatus = readManualOperationIdempotencyStatus(
      match,
      operationKey,
      operationSignature
    );
    if (idempotencyStatus === 'MATCH') {
      touchMatch(match);
      return { success: true, snapshot: this.buildSnapshotForParticipant(match, participant) };
    }
    if (idempotencyStatus === 'CONFLICT') {
      touchMatch(match);
      return { success: false, error: '重复请求的自由模式响应不一致' };
    }
    const request = match.pendingManualOperationModeRequest;
    if (!request || request.requestId !== requestId) {
      touchMatch(match);
      return { success: false, error: '自由模式请求不存在或已失效' };
    }
    if (request.responderSeat !== participant.seat) {
      touchMatch(match);
      return { success: false, error: '只有对方可以同意自由模式请求' };
    }
    if (input.expectedRevision !== match.remoteRevision) {
      touchMatch(match);
      return { success: false, error: '对局状态已更新，请刷新后重试' };
    }
    const blockedReason = match.session.getManualOperationModeSwitchBlockedReason();
    if (blockedReason) {
      touchMatch(match);
      return { success: false, error: blockedReason };
    }

    const result = match.session.setManualOperationMode('FREE');
    if (!result.success) {
      touchMatch(match);
      return { success: false, error: result.error };
    }
    match.pendingManualOperationModeRequest = null;
    match.activeUndoGrant = null;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'SYSTEM_TRANSITION', {
      summary: `${participant.displayName} 同意开启自由模式`,
      force: true,
      writeAuthorityCheckpoint: true,
      dedupeKey: `${match.recordBranchId}:MANUAL_MODE_ACCEPTED:${request.requestId}:${match.remoteRevision}`,
    });
    recordManualOperationIdempotency(match, operationKey, operationSignature);
    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async rejectManualOperationModeRequest(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondManualOperationModeRequestInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.settleManualOperationModeRequest(matchId, userId, requestId, input, 'REJECT')
    );
  }

  async cancelManualOperationModeRequest(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondManualOperationModeRequestInput
  ): Promise<OnlineCommandResult | null> {
    return this.serialExecutor.runExclusive(matchId, () =>
      this.settleManualOperationModeRequest(matchId, userId, requestId, input, 'CANCEL')
    );
  }

  private async settleManualOperationModeRequest(
    matchId: string,
    userId: string,
    requestId: string,
    input: RespondManualOperationModeRequestInput,
    action: 'REJECT' | 'CANCEL'
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }
    const participant = getParticipantByUserId(match, userId);
    if (!participant || participant.participantKind !== 'USER') {
      return null;
    }
    await this.expirePendingManualOperationModeRequestIfNeeded(match);
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const operationKey = buildManualOperationIdempotencyKey(participant.userId, idempotencyKey);
    const operationSignature = `${action}:${requestId}`;
    const idempotencyStatus = readManualOperationIdempotencyStatus(
      match,
      operationKey,
      operationSignature
    );
    if (idempotencyStatus === 'MATCH') {
      touchMatch(match);
      return { success: true, snapshot: this.buildSnapshotForParticipant(match, participant) };
    }
    if (idempotencyStatus === 'CONFLICT') {
      touchMatch(match);
      return { success: false, error: '重复请求的自由模式响应不一致' };
    }
    const request = match.pendingManualOperationModeRequest;
    if (!request || request.requestId !== requestId) {
      touchMatch(match);
      return { success: false, error: '自由模式请求不存在或已失效' };
    }
    const allowedSeat = action === 'REJECT' ? request.responderSeat : request.requesterSeat;
    if (participant.seat !== allowedSeat) {
      touchMatch(match);
      return {
        success: false,
        error:
          action === 'REJECT' ? '只有对方可以拒绝自由模式请求' : '只有发起方可以取消自由模式请求',
      };
    }
    if (input.expectedRevision !== match.remoteRevision) {
      touchMatch(match);
      return { success: false, error: '对局状态已更新，请刷新后重试' };
    }

    match.pendingManualOperationModeRequest = null;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'SYSTEM_TRANSITION', {
      summary:
        action === 'REJECT'
          ? `${participant.displayName} 拒绝开启自由模式`
          : `${participant.displayName} 取消了自由模式请求`,
      force: true,
      writeAuthorityCheckpoint: false,
      dedupeKey: `${match.recordBranchId}:MANUAL_MODE_${action}:${request.requestId}:${match.remoteRevision}`,
    });
    recordManualOperationIdempotency(match, operationKey, operationSignature);
    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
  }

  async deleteMatch(matchId: string, options: DeleteOnlineMatchOptions = {}): Promise<boolean> {
    return this.serialExecutor.runExclusive(matchId, (criticalSection) =>
      this.deleteMatchInCriticalSection(matchId, options, criticalSection)
    );
  }

  private async deleteMatchInCriticalSection(
    matchId: string,
    options: DeleteOnlineMatchOptions,
    criticalSection: SingleMatchCriticalSection
  ): Promise<boolean> {
    const match = this.matches.get(matchId);
    if (!match) {
      this.deadlineOwner.cancelMatch(matchId);
      this.machineDecisionScheduler.cancelMatch(matchId);
      this.modelInvocationRuntime?.cancelMatch(matchId);
      this.machineDecisionCoordinator.invalidateMatchInCriticalSection(criticalSection, matchId);
      this.machineStrategyRuntimes.delete(buildMachineStrategyRuntimeKey(matchId, 'FIRST'));
      this.machineStrategyRuntimes.delete(buildMachineStrategyRuntimeKey(matchId, 'SECOND'));
      return true;
    }

    const sealed = await this.sealMatchForRemoval(
      match,
      options.reason ?? 'MATCH_DELETED',
      options.now ?? this.now()
    );
    if (!sealed) {
      return false;
    }

    const now = options.now ?? this.now();
    this.deadlineOwner.cancelMatch(matchId);
    this.machineDecisionScheduler.cancelMatch(matchId);
    this.modelInvocationRuntime?.cancelMatch(matchId);
    this.machineDecisionCoordinator.invalidateMatchInCriticalSection(criticalSection, matchId);
    this.matches.delete(matchId);
    this.machineStrategyRuntimes.delete(buildMachineStrategyRuntimeKey(matchId, 'FIRST'));
    this.machineStrategyRuntimes.delete(buildMachineStrategyRuntimeKey(matchId, 'SECOND'));
    for (const [token, link] of this.spectatorLinks) {
      if (link.matchId === matchId) {
        if (options.preserveRoomCodeSpectators && link.source === 'ROOM_CODE') {
          this.detachRoomCodeSpectatorLink(link, matchId);
        } else if (link.source === 'ROOM_CODE') {
          this.terminateRoomCodeSpectatorLink(link, 'ROOM_CLOSED', now);
        } else {
          this.spectatorLinks.delete(token);
          this.deleteSpectatorSessionsForToken(token);
        }
      }
    }
    this.sealedMatchIds.delete(matchId);
    this.partialRecordMatchIds.delete(matchId);
    return true;
  }

  attachRoomCodeSpectators(
    matchId: string,
    roomGeneration: string,
    authorizedViewerSeats: readonly Seat[]
  ): void {
    const match = this.matches.get(matchId);
    if (!match) {
      return;
    }
    for (const link of this.spectatorLinks.values()) {
      if (
        link.source !== 'ROOM_CODE' ||
        link.roomCode !== match.roomCode ||
        link.roomGeneration !== roomGeneration ||
        link.revokedAt !== null
      ) {
        continue;
      }
      this.attachRoomCodeSpectatorLink(link, match, authorizedViewerSeats);
    }
    touchMatch(match);
  }

  terminateRoomCodeSpectators(
    roomCode: string,
    roomGeneration: string,
    reason: 'ROOM_CLOSED' | 'ROOM_REPLACED',
    now = this.now()
  ): void {
    for (const link of this.spectatorLinks.values()) {
      if (
        link.source === 'ROOM_CODE' &&
        link.roomCode === roomCode &&
        link.roomGeneration === roomGeneration &&
        link.revokedAt === null
      ) {
        this.terminateRoomCodeSpectatorLink(link, reason, now);
      }
    }
  }

  private attachRoomCodeSpectatorLink(
    link: OnlineSpectatorLinkState,
    match: OnlineMatchState,
    authorizedViewerSeats: readonly Seat[]
  ): void {
    const nextAuthorizedSeats = normalizeViewerSeats(authorizedViewerSeats).filter((seat) =>
      link.knownRoomMemberUserIds.has(match.participants[seat].userId)
    );
    const nextAuthorizedUserIds = nextAuthorizedSeats.map(
      (seat) => match.participants[seat].userId
    );
    replaceAuthorizedViewerSeats(link.authorizedViewerSeats, nextAuthorizedSeats);
    replaceStringSet(link.authorizedViewerUserIds, nextAuthorizedUserIds);

    const preferredSeat = findSeatByUserId(match, link.preferredViewerUserId);
    const nextViewerSeat =
      preferredSeat && link.authorizedViewerSeats.has(preferredSeat)
        ? preferredSeat
        : nextAuthorizedSeats[0];
    if (!nextViewerSeat) {
      this.terminateRoomCodeSpectatorLink(link, 'ROOM_CODE_AUTHORIZATION_CLOSED', this.now());
      return;
    }

    const bindingChanged = link.matchId !== match.matchId;
    if (bindingChanged) {
      link.attachmentGeneration += 1;
    }
    link.matchId = match.matchId;
    link.viewerSeat = nextViewerSeat;
    const preferredParticipant = link.preferredViewerUserId
      ? getParticipantByUserId(match, link.preferredViewerUserId)
      : null;
    if (preferredParticipant) {
      link.preferredViewerDisplayName = preferredParticipant.displayName;
    }

    for (const session of this.spectatorSessions.values()) {
      if (session.token !== link.token || session.endedAt !== null) {
        continue;
      }
      const previousMatchId = session.matchId;
      const sessionPreferredSeat = findSeatByUserId(match, session.preferredViewerUserId);
      const previousEffectiveSeat = findSeatByUserId(match, session.effectiveViewerUserId);
      const sessionViewerSeat =
        sessionPreferredSeat && link.authorizedViewerSeats.has(sessionPreferredSeat)
          ? sessionPreferredSeat
          : previousEffectiveSeat && link.authorizedViewerSeats.has(previousEffectiveSeat)
            ? previousEffectiveSeat
            : nextViewerSeat;
      session.previousMatchId = previousMatchId ?? session.previousMatchId;
      session.matchId = match.matchId;
      session.attachmentGeneration = link.attachmentGeneration;
      session.viewerSeat = sessionViewerSeat;
      replaceAuthorizedViewerSeats(session.authorizedViewerSeats, nextAuthorizedSeats);
      replaceStringSet(session.authorizedViewerUserIds, nextAuthorizedUserIds);
      const effectiveParticipant = match.participants[sessionViewerSeat];
      session.effectiveViewerUserId = effectiveParticipant.userId;
      session.effectiveViewerDisplayName = effectiveParticipant.displayName;
      const sessionPreferredParticipant = session.preferredViewerUserId
        ? getParticipantByUserId(match, session.preferredViewerUserId)
        : null;
      if (sessionPreferredParticipant) {
        session.preferredViewerDisplayName = sessionPreferredParticipant.displayName;
      }
      session.authorizationNotice = null;
      if (bindingChanged || previousMatchId !== match.matchId) {
        session.viewVersion += 1;
      }
    }
  }

  private detachRoomCodeSpectatorLink(
    link: OnlineSpectatorLinkState,
    previousMatchId: string
  ): void {
    link.matchId = null;
    link.viewerSeat = null;
    link.attachmentGeneration += 1;
    link.authorizedViewerSeats.clear();
    for (const session of this.spectatorSessions.values()) {
      if (session.token !== link.token || session.endedAt !== null) {
        continue;
      }
      session.previousMatchId = session.matchId ?? previousMatchId;
      session.matchId = null;
      session.viewerSeat = null;
      session.attachmentGeneration = link.attachmentGeneration;
      session.authorizedViewerSeats.clear();
      session.authorizationNotice = null;
      session.viewVersion += 1;
    }
  }

  private terminateRoomCodeSpectatorLink(
    link: OnlineSpectatorLinkState,
    reason: NonNullable<OnlineSpectatorLinkState['revokedReason']>,
    now: number
  ): void {
    link.revokedAt = now;
    link.revokedReason = reason;
    for (const session of this.spectatorSessions.values()) {
      if (session.token !== link.token || session.endedAt !== null) {
        continue;
      }
      endSpectatorSession(
        session,
        reason === 'ROOM_CODE_AUTHORIZATION_CLOSED' ? 'AUTHORIZATION_CLOSED' : reason,
        now
      );
    }
  }

  async cleanupExpiredMatches(
    activeMatchIds: ReadonlySet<string>,
    now = Date.now()
  ): Promise<OnlineMatchCleanupSummary> {
    let checkedMatchCount = 0;
    let staleMatchCount = 0;
    let deletedMatchCount = 0;
    let failedDeleteCount = 0;

    for (const [matchId, match] of this.matches) {
      checkedMatchCount += 1;
      if (activeMatchIds.has(matchId)) {
        continue;
      }

      if (now - match.lastActivityAt > MATCH_STALE_TTL_MS) {
        staleMatchCount += 1;
        const deleted = await this.deleteMatch(matchId, {
          reason: 'STALE_MATCH_CLEANUP',
          now,
        });
        if (deleted) {
          deletedMatchCount += 1;
        } else {
          failedDeleteCount += 1;
        }
      }
    }
    this.cleanupExpiredSpectatorState(now);

    return {
      checkedMatchCount,
      staleMatchCount,
      deletedMatchCount,
      failedDeleteCount,
    };
  }

  clear(): void {
    for (const matchId of this.matches.keys()) {
      this.modelInvocationRuntime?.cancelMatch(matchId);
    }
    this.deadlineOwner.dispose();
    this.machineDecisionScheduler.dispose();
    this.machineDecisionCoordinator.dispose();
    this.matches.clear();
    this.machineStrategyRuntimes.clear();
    this.spectatorLinks.clear();
    this.spectatorSessions.clear();
    this.spectatorRequestWindows.clear();
    this.sealedMatchIds.clear();
    this.partialRecordMatchIds.clear();
  }

  private requireActiveSpectatorLink(
    tokenInput: string,
    now: number
  ): { readonly link: OnlineSpectatorLinkState; readonly match: OnlineMatchState | null } {
    const token = normalizeSpectatorToken(tokenInput);
    const link = token ? this.spectatorLinks.get(token) : undefined;
    if (link && link.revokedAt !== null && link.revokedReason) {
      const error = getSpectatorLinkEndError(link.revokedReason);
      throw new OnlineSpectatorServiceError(error.code, error.message, 410);
    }
    if (!link) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_LINK_NOT_FOUND',
        '观战链接不存在或已被撤销',
        404
      );
    }
    if (link.expiresAt <= now) {
      throw new OnlineSpectatorServiceError('ONLINE_SPECTATOR_LINK_EXPIRED', '观战链接已过期', 410);
    }

    const match = link.matchId ? (this.matches.get(link.matchId) ?? null) : null;
    if (!match && link.source === 'ADMIN_LINK') {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_MATCH_NOT_FOUND',
        '观战对局不存在或已失效',
        404
      );
    }

    return { link, match };
  }

  private requireActiveSpectatorSession(
    link: OnlineSpectatorLinkState,
    sessionId: string | null | undefined,
    now: number
  ): OnlineSpectatorSessionState {
    const normalizedSessionId = normalizeSpectatorToken(sessionId ?? '');
    if (!normalizedSessionId) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_SESSION_REQUIRED',
        '观战会话已失效，请重新进入观战',
        401
      );
    }

    const session = this.spectatorSessions.get(normalizedSessionId);
    if (!session || session.token !== link.token) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_SESSION_INVALID',
        '观战会话已失效，请重新进入观战',
        401
      );
    }
    if (session.endedAt !== null || !isSpectatorSessionActive(session, now)) {
      if (session.endedAt === null) {
        endSpectatorSession(session, 'SESSION_EXPIRED', now);
      }
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_SESSION_EXPIRED',
        '观战会话已过期，请重新输入房间号',
        410
      );
    }
    if (session.matchId !== link.matchId) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_SESSION_INVALID',
        '观战会话已失效，请重新进入观战',
        401
      );
    }
    if (
      link.matchId !== null &&
      (!session.viewerSeat || !link.authorizedViewerSeats.has(session.viewerSeat))
    ) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_VIEW_FORBIDDEN',
        '当前观战视角已被收回',
        403
      );
    }

    session.lastSeenAt = now;
    return session;
  }

  private cleanupExpiredSpectatorState(now: number): void {
    for (const [sessionId, session] of this.spectatorSessions) {
      if (session.endedAt === null && !isSpectatorSessionActive(session, now)) {
        endSpectatorSession(session, 'SESSION_EXPIRED', now);
      }
      if (session.endedAt !== null && now - session.endedAt > SPECTATOR_TOMBSTONE_TTL_MS) {
        this.spectatorSessions.delete(sessionId);
        this.spectatorRequestWindows.delete(sessionId);
      }
    }

    for (const [token, link] of this.spectatorLinks) {
      const terminalAt = link.revokedAt ?? link.expiresAt;
      const adminMatchMissing =
        link.source === 'ADMIN_LINK' && (link.matchId === null || !this.matches.has(link.matchId));
      if (
        (link.expiresAt <= now || link.revokedAt !== null || adminMatchMissing) &&
        now - terminalAt > SPECTATOR_TOMBSTONE_TTL_MS
      ) {
        this.spectatorLinks.delete(token);
        this.deleteSpectatorSessionsForToken(token);
      }
    }
  }

  private deleteSpectatorSessionsForToken(token: string): void {
    for (const [sessionId, session] of this.spectatorSessions) {
      if (session.token === token) {
        this.spectatorSessions.delete(sessionId);
        this.spectatorRequestWindows.delete(sessionId);
      }
    }
  }

  private countActivePublicSpectatorSessionsForRoom(
    roomCode: string,
    roomGeneration: string | null,
    now: number
  ): number {
    let count = 0;
    for (const session of this.spectatorSessions.values()) {
      if (
        session.roomCode === roomCode &&
        session.roomGeneration === roomGeneration &&
        session.countsInPresence &&
        isSpectatorSessionActive(session, now)
      ) {
        count += 1;
      }
    }
    return count;
  }

  private consumeSpectatorRequest(session: OnlineSpectatorSessionState, now: number): void {
    const current = this.spectatorRequestWindows.get(session.sessionId);
    if (!current || now - current.windowStartedAt >= this.spectatorRequestWindowMs) {
      this.spectatorRequestWindows.set(session.sessionId, {
        windowStartedAt: now,
        requestCount: 1,
      });
      return;
    }
    if (current.requestCount >= this.spectatorRequestLimit) {
      const retryAfterMs = Math.max(
        1,
        current.windowStartedAt + this.spectatorRequestWindowMs - now
      );
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_RATE_LIMITED',
        '观战同步暂时繁忙，请稍等',
        429,
        retryAfterMs
      );
    }
    current.requestCount += 1;
  }

  private findActiveSpectatorSessionByClientId(
    token: string,
    clientId: string,
    now: number
  ): OnlineSpectatorSessionState | null {
    for (const session of this.spectatorSessions.values()) {
      if (
        session.token === token &&
        session.clientId === clientId &&
        isSpectatorSessionActive(session, now)
      ) {
        return session;
      }
    }
    return null;
  }

  private createGuestDisplayName(matchId: string, now: number): string {
    const usedIndexes = new Set<number>();
    for (const session of this.spectatorSessions.values()) {
      if (
        session.matchId !== matchId ||
        !session.countsInPresence ||
        !isSpectatorSessionActive(session, now)
      ) {
        continue;
      }
      const match = /^游客\s+(\d+)$/.exec(session.displayName.trim());
      const index = match ? Number.parseInt(match[1], 10) : 0;
      if (Number.isSafeInteger(index) && index > 0) {
        usedIndexes.add(index);
      }
    }

    let nextIndex = 1;
    while (usedIndexes.has(nextIndex)) {
      nextIndex += 1;
    }
    return `游客 ${nextIndex}`;
  }

  private async expirePendingUndoRequestIfNeeded(match: OnlineMatchState): Promise<void> {
    const request = match.pendingUndoRequest;
    if (!request || request.expiresAt > this.now()) {
      return;
    }
    await this.expirePendingUndoRequest(match, '撤销请求已超时');
  }

  private async expirePendingManualOperationModeRequestIfNeeded(
    match: OnlineMatchState
  ): Promise<void> {
    const request = match.pendingManualOperationModeRequest;
    if (!request || request.expiresAt > this.now()) {
      return;
    }
    await this.expirePendingManualOperationModeRequest(match, '自由模式请求已超时');
  }

  private async expirePendingManualOperationModeRequest(
    match: OnlineMatchState,
    summary: string
  ): Promise<void> {
    const request = match.pendingManualOperationModeRequest;
    if (!request) {
      return;
    }
    match.pendingManualOperationModeRequest = null;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'SYSTEM_TRANSITION', {
      summary,
      force: true,
      writeAuthorityCheckpoint: false,
      dedupeKey: `${match.recordBranchId}:MANUAL_MODE_EXPIRED:${request.requestId}:${match.remoteRevision}`,
    });
  }

  private async expirePendingUndoRequest(match: OnlineMatchState, summary: string): Promise<void> {
    const request = match.pendingUndoRequest;
    if (!request) {
      return;
    }

    match.pendingUndoRequest = null;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'UNDO_EXPIRED', {
      summary: `${summary}：${request.summary}`,
      force: true,
      writeAuthorityCheckpoint: false,
      dedupeKey: `${match.recordBranchId}:UNDO_EXPIRED:${request.requestId}:${match.remoteRevision}`,
    });
  }

  private async expireActiveUndoGrantIfNeeded(match: OnlineMatchState): Promise<void> {
    const grant = match.activeUndoGrant;
    if (!grant || grant.expiresAt > this.now()) {
      return;
    }
    await this.expireActiveUndoGrant(match, '连续撤销授权已超时');
  }

  private async expireActiveUndoGrantIfNoLongerUsable(match: OnlineMatchState): Promise<void> {
    const grant = match.activeUndoGrant;
    if (!grant) {
      return;
    }

    const requester = match.participants[grant.requesterSeat];
    const availability = match.session.getUndoAvailability(requester.playerId, 'REMOTE_REQUEST');
    if (
      availability.canUndoNow &&
      availability.entry &&
      getUsableUndoGrant(match, requester, availability.entry)
    ) {
      return;
    }

    await this.expireActiveUndoGrant(match, '连续撤销授权已无可撤销目标');
  }

  private async expireActiveUndoGrant(match: OnlineMatchState, summary: string): Promise<void> {
    const grant = match.activeUndoGrant;
    if (!grant) {
      return;
    }

    match.activeUndoGrant = null;
    this.incrementAuthorityRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'UNDO_EXPIRED', {
      summary,
      force: true,
      writeAuthorityCheckpoint: false,
      dedupeKey: `${match.recordBranchId}:UNDO_GRANT_EXPIRED:${grant.grantId}:${match.remoteRevision}`,
    });
  }

  private async markRecordIncomplete(
    matchId: string,
    status: 'CORRUPTED' | 'INTERRUPTED',
    partialReason: string,
    recorderError: string
  ): Promise<void> {
    if (!this.recorder) {
      return;
    }

    try {
      await this.recorder.markPartial({
        matchId,
        status,
        completeness: 'INCOMPLETE',
        partialReason,
        recorderError,
        appendFailureAt: this.now(),
      });
    } catch {
      // Keep the original recorder error as the actionable failure for the caller.
    }
  }

  private async sealCompletedMatchIfNeeded(match: OnlineMatchState): Promise<void> {
    const authorityState = match.session.getAuthoritySnapshotForRecord();
    if (!authorityState || authorityState.currentPhase !== GamePhase.GAME_END) {
      return;
    }

    await this.sealMatchRecord(match, {
      status: getCompletedMatchRecordStatus(authorityState),
      completeness: this.getSealCompleteness(match, 'FULL'),
      endReason: authorityState.endInfo?.reason ?? 'GAME_END',
      now: authorityState.endInfo?.endTimestamp ?? this.now(),
      authorityState,
    });
  }

  private async sealMatchForRemoval(
    match: OnlineMatchState,
    reason: string,
    now: number
  ): Promise<boolean> {
    const authorityState = match.session.getAuthoritySnapshotForRecord();
    const completed = authorityState?.currentPhase === GamePhase.GAME_END;
    return this.sealMatchRecord(match, {
      status: completed ? getCompletedMatchRecordStatus(authorityState) : 'INTERRUPTED',
      completeness: completed ? this.getSealCompleteness(match, 'FULL') : 'PARTIAL',
      endReason: completed ? (authorityState.endInfo?.reason ?? 'GAME_END') : reason,
      now: completed ? (authorityState.endInfo?.endTimestamp ?? now) : now,
      authorityState,
    });
  }

  private async sealMatchRecord(
    match: OnlineMatchState,
    input: {
      readonly status: Exclude<MatchRecordStatus, 'IN_PROGRESS'>;
      readonly completeness: MatchRecordCompleteness;
      readonly endReason: string;
      readonly now: number;
      readonly authorityState: GameState | null;
    }
  ): Promise<boolean> {
    if (!this.recorder || this.sealedMatchIds.has(match.matchId)) {
      return true;
    }

    const winnerSeat = input.authorityState?.endInfo?.winnerId
      ? getSeatByPlayerId(match, input.authorityState.endInfo.winnerId)
      : null;

    try {
      await this.recorder.sealMatch({
        matchId: match.matchId,
        status: input.status,
        completeness: input.completeness,
        endedAt: input.now,
        sealedAt: input.now,
        winnerSeat,
        endReason: input.endReason,
        turnCount: input.authorityState?.turnCount ?? 0,
        phase: input.authorityState?.currentPhase ?? 'UNKNOWN',
        subPhase: input.authorityState?.currentSubPhase ?? 'UNKNOWN',
      });
      this.sealedMatchIds.add(match.matchId);
      if (
        match.originKind === 'RANKED' &&
        input.completeness === 'FULL' &&
        (input.status === 'COMPLETED' || input.status === 'SURRENDERED')
      ) {
        try {
          await rankedRatingService.settleMatch(match.matchId);
        } catch (error) {
          console.error(
            JSON.stringify({
              scope: 'ranked_settlement',
              event: 'RANKED_SETTLEMENT_DEFERRED',
              matchId: match.matchId,
              message: readErrorMessage(error),
            })
          );
        }
      }
      return true;
    } catch (error) {
      await this.markRecordIncomplete(
        match.matchId,
        input.status === 'COMPLETED' ? 'CORRUPTED' : 'INTERRUPTED',
        `${input.status.toLowerCase()} seal failed`,
        readErrorMessage(error)
      );
      return false;
    }
  }

  private async appendSessionRecordFrame(
    match: OnlineMatchState,
    frameType: AppendMatchRecordFrameInput['frameType'],
    options: {
      readonly summary?: string;
      readonly force?: boolean;
      readonly writeAuthorityCheckpoint?: boolean;
      readonly command?: GameCommand;
      readonly authorityState?: GameState | null;
      readonly decisionRecords?: readonly MatchDecisionRecordInput[];
      readonly dedupeKey?: string;
    } = {}
  ): Promise<boolean> {
    if (!this.recorder || this.sealedMatchIds.has(match.matchId)) {
      return true;
    }

    try {
      const cursor = await this.recorder.getRecordCursor(match.matchId);
      if (!cursor) {
        await this.markRecordAppendFailed(
          match.matchId,
          'append cursor missing',
          '历史对局记录游标不存在'
        );
        return false;
      }
      const captureCursor = match.recordCaptureCursor;

      const firstPrivateEvents = match.session.getPrivateEventsSince(
        match.participants.FIRST.playerId,
        captureCursor.privateSeqBySeat.FIRST
      );
      const secondPrivateEvents = match.session.getPrivateEventsSince(
        match.participants.SECOND.playerId,
        captureCursor.privateSeqBySeat.SECOND
      );
      const publicEvents = match.session.getPublicEventsSince(captureCursor.publicSeq);
      const sealedAudit = match.session.getSealedAuditSince(captureCursor.auditSeq);
      const commandLog = match.session.getCommandLogSince(captureCursor.commandSeq);
      const gameEvents = match.session.getGameEventsSince(captureCursor.gameEventSeq);
      const latestCommandRecord = commandLog.at(-1);
      const hasNewFacts =
        publicEvents.length > 0 ||
        firstPrivateEvents.length > 0 ||
        secondPrivateEvents.length > 0 ||
        sealedAudit.length > 0 ||
        commandLog.length > 0 ||
        gameEvents.length > 0 ||
        (options.decisionRecords?.length ?? 0) > 0;

      if (!hasNewFacts && !options.force) {
        return true;
      }

      const writeAuthorityCheckpoint =
        options.writeAuthorityCheckpoint ??
        shouldWriteAuthorityCheckpointForFrame(match, frameType, {
          command: options.command,
          cursorLastTimelineSeq: cursor.lastTimelineSeq,
        });
      const authorityState =
        writeAuthorityCheckpoint && options.authorityState
          ? options.authorityState
          : writeAuthorityCheckpoint
            ? match.session.getAuthoritySnapshotForRecord()
            : null;
      await this.recorder.appendMatchRecordFrame({
        matchId: match.matchId,
        frameType,
        summary:
          options.summary ??
          (frameType === 'COMMAND_REJECTED'
            ? buildRejectedCommandSummary(options.command, latestCommandRecord)
            : undefined),
        authorityState,
        stateSummary: buildRecordStateSummary(match.session.state),
        writeAuthorityCheckpoint,
        relatedPublicSeq:
          latestSeq(publicEvents, (event) => event.seq) ?? match.session.getCurrentPublicEventSeq(),
        relatedPrivateSeq: maxNullable(
          latestSeq(firstPrivateEvents, (event) => event.seq),
          latestSeq(secondPrivateEvents, (event) => event.seq)
        ),
        relatedAuditSeq: latestSeq(sealedAudit, (record) => record.seq),
        relatedCommandSeq: latestCommandRecord?.seq ?? null,
        relatedGameEventSeq:
          latestSeq(gameEvents, (event) => event.sequence) ??
          match.session.getCurrentGameEventSeq(),
        latestPrivateSeqBySeat: {
          FIRST:
            latestSeq(firstPrivateEvents, (event) => event.seq) ??
            captureCursor.privateSeqBySeat.FIRST,
          SECOND:
            latestSeq(secondPrivateEvents, (event) => event.seq) ??
            captureCursor.privateSeqBySeat.SECOND,
        },
        publicEvents,
        privateEventsBySeat: {
          FIRST: firstPrivateEvents,
          SECOND: secondPrivateEvents,
        },
        decisionRecords: options.decisionRecords,
        dedupeKey:
          options.dedupeKey ??
          buildRemoteFrameDedupeKey(match, frameType, {
            relatedPublicSeq:
              latestSeq(publicEvents, (event) => event.seq) ??
              match.session.getCurrentPublicEventSeq(),
            relatedCommandSeq: latestCommandRecord?.seq ?? null,
            relatedGameEventSeq:
              latestSeq(gameEvents, (event) => event.sequence) ??
              match.session.getCurrentGameEventSeq(),
          }),
        createdAt: this.now(),
      });
      match.recordCaptureCursor = match.session.getRuntimeCaptureCursor();
      return true;
    } catch (error) {
      await this.markRecordAppendFailed(
        match.matchId,
        `${frameType.toLowerCase()} append failed`,
        readErrorMessage(error)
      );
      return false;
    }
  }

  private async markRecordAppendFailed(
    matchId: string,
    partialReason: string,
    recorderError: string
  ): Promise<void> {
    if (!this.recorder) {
      return;
    }

    this.partialRecordMatchIds.add(matchId);
    try {
      await this.recorder.markPartial({
        matchId,
        completeness: 'PARTIAL',
        partialReason,
        recorderError,
        appendFailureAt: this.now(),
      });
    } catch {
      // The match must continue; the append failure itself is already the primary fault.
    }
  }

  private getSealCompleteness(
    match: OnlineMatchState,
    fallback: MatchRecordCompleteness
  ): MatchRecordCompleteness {
    return this.partialRecordMatchIds.has(match.matchId) ? 'PARTIAL' : fallback;
  }
}

const configuredAiBattleModelProvider = createConfiguredAiBattleModelProvider();
export const onlineMatchService = new OnlineMatchService({
  machineDecisionSchedulingEnabled: true,
  modelInvocationRuntime: configuredAiBattleModelProvider
    ? createAiModelInvocationRuntime({ provider: configuredAiBattleModelProvider })
    : null,
});

function createConservativeAuditableResult(
  contract: AiDecisionContract
): AuditableAiDecisionResult | null {
  const selected = selectConservativeDecision(contract);
  return selected.ok
    ? {
        policyVersion: selected.policyVersion,
        tier: 'DETERMINISTIC',
        reasonCode: 'MODEL_FAILURE_CONSERVATIVE_FALLBACK',
        summary: 'Use the certified conservative choice after model unavailability.',
        consideredIds: [],
        selection: selected.selection,
      }
    : null;
}

function collectModelConsideredIds(context: AiStrategyContext): readonly string[] {
  const decision = context.observation.decision;
  return [
    ...new Set([
      ...decision.candidates.map((candidate) => candidate.candidateId),
      ...decision.options.map((option) => option.optionId),
      ...decision.actions.map((action) => action.actionId),
      ...(decision.input?.groups?.flatMap((group) => group.candidateIds) ?? []),
      ...(decision.input?.members?.map((member) => member.candidateId) ?? []),
    ]),
  ].sort();
}

function withModelAttemptOutcome(
  attempt: AiModelInvocationAttemptAudit,
  outcome: 'INVALID_JSON' | 'INVALID_SCHEMA' | 'INVALID_SELECTION'
): AiModelInvocationAttemptAudit {
  return { ...attempt, outcome, usage: { ...attempt.usage } };
}

function buildSnapshot(
  match: OnlineMatchState,
  participant: OnlineMatchParticipant,
  options: {
    readonly undoView?: OnlineUndoView;
    readonly publicEvents?: readonly PublicEvent[];
    readonly truncated?: boolean;
    readonly droppedEventCount?: number;
    readonly recovery?: RuntimeRecoveryInfo;
  } = {}
): OnlineMatchSnapshot {
  const projectedViewState = match.session.getPlayerViewState(participant.playerId, {
    seqOverride: match.remoteRevision,
  });
  if (!projectedViewState) {
    throw new Error('联机玩家视图不存在');
  }
  const playerViewState = {
    ...projectedViewState,
    match: {
      ...projectedViewState.match,
      participants: {
        FIRST: {
          ...projectedViewState.match.participants.FIRST,
          participantKind: match.participants.FIRST.participantKind,
        },
        SECOND: {
          ...projectedViewState.match.participants.SECOND,
          participantKind: match.participants.SECOND.participantKind,
        },
      },
      undo: options.undoView ?? buildOnlineUndoView(match, participant),
      manualOperation: buildManualOperationModeView(match, participant),
    },
  };

  return {
    matchId: match.matchId,
    seat: participant.seat,
    playerId: participant.playerId,
    seq: match.remoteRevision,
    currentPublicSeq: match.session.getCurrentPublicEventSeq(),
    playerViewState,
    ...(options.publicEvents !== undefined ? { publicEvents: options.publicEvents } : {}),
    ...(options.truncated !== undefined ? { truncated: options.truncated } : {}),
    ...(options.droppedEventCount !== undefined
      ? { droppedEventCount: options.droppedEventCount }
      : {}),
    ...(options.recovery !== undefined ? { recovery: options.recovery } : {}),
  };
}

function buildRecoverySummary(recovery: RuntimeRecoveryInfo): string {
  const rolledBackSegments: string[] = [];
  if (recovery.rolledBackFromTimelineSeq !== null) {
    rolledBackSegments.push(
      `timeline ${recovery.rolledBackFromTimelineSeq}->${recovery.checkpointTimelineSeq}`
    );
  }
  if (recovery.rolledBackFromPublicSeq !== null) {
    rolledBackSegments.push(
      `public ${recovery.rolledBackFromPublicSeq}->${recovery.currentPublicSeq}`
    );
  }
  const rollbackSummary =
    rolledBackSegments.length > 0 ? `；回退 ${rolledBackSegments.join('，')}` : '';
  return `对局运行态恢复到 checkpoint#${recovery.checkpointSeq}${rollbackSummary}`;
}

function buildRecoveryDedupeKey(match: OnlineMatchState, recovery: RuntimeRecoveryInfo): string {
  return [
    match.recordBranchId,
    'runtime-recovery',
    recovery.checkpointSeq,
    recovery.checkpointTimelineSeq,
    recovery.currentPublicSeq,
    recovery.rolledBackFromTimelineSeq ?? 'none',
    recovery.rolledBackFromPublicSeq ?? 'none',
    recovery.restoredAt,
  ].join(':');
}

function buildReadonlySpectatorSnapshot(
  match: OnlineMatchState,
  link: OnlineSpectatorLinkState,
  session: OnlineSpectatorSessionState
): OnlineSpectatorMatchSnapshot {
  if (!session.viewerSeat) {
    throw new Error('观战会话缺少当前对局席位');
  }
  const snapshot = buildSnapshot(match, match.participants[session.viewerSeat], {
    undoView: buildReadonlyUndoView(),
  });
  return {
    ...snapshot,
    playerViewState: {
      ...snapshot.playerViewState,
      match: {
        ...snapshot.playerViewState.match,
        manualOperation: {
          ...buildManualOperationModeView(match),
          canSwitchNow: false,
          disabledReason: '观战模式为只读',
        },
      },
      permissions: { availableCommands: [] },
    },
    spectatorView: buildSpectatorViewState(link, session),
  };
}

function buildReadonlyUndoView(): OnlineUndoView {
  return {
    policy: 'NONE',
    canUndoNow: false,
    disabledReason: '观战模式为只读',
    entry: null,
    pendingRequest: null,
    grant: null,
  };
}

function buildManualOperationModeView(
  match: OnlineMatchState,
  participant?: OnlineMatchParticipant
): ManualOperationModeView {
  const blockedReason = match.session.getManualOperationModeSwitchBlockedReason();
  const request = match.pendingManualOperationModeRequest;
  const disabledReason =
    (participant && hasFormalAiOpponent(match, participant) ? 'AI 对战固定使用规则模式' : null) ??
    blockedReason ??
    (match.pendingUndoRequest
      ? '请先处理当前撤销请求'
      : request
        ? '请先处理当前自由模式请求'
        : null);
  return {
    mode: match.session.manualOperationMode,
    canSwitchNow: disabledReason === null,
    disabledReason,
    pendingRequest: request
      ? {
          requestId: request.requestId,
          requesterSeat: request.requesterSeat,
          targetMode: request.targetMode,
          targetRevision: request.targetRevision,
          expiresAt: new Date(request.expiresAt).toISOString(),
        }
      : null,
  };
}

function buildSpectatorLinkView(link: OnlineSpectatorLinkState): OnlineSpectatorLinkView {
  return {
    token: link.token,
    source: link.source,
    matchId: link.matchId,
    roomCode: link.roomCode,
    roomGeneration: link.roomGeneration,
    attachmentGeneration: link.attachmentGeneration,
    viewType: link.viewType,
    viewerSeat: link.viewerSeat,
    authorizedViewerSeats: normalizeViewerSeats(link.authorizedViewerSeats),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    path: `/online/spectate/${encodeURIComponent(link.token)}`,
  };
}

function buildSpectatorSessionView(
  session: OnlineSpectatorSessionState
): OnlineSpectatorSessionView {
  return {
    sessionId: session.sessionId,
    displayName: session.displayName,
    viewType: session.viewType,
    viewerSeat: session.viewerSeat,
    authorizedViewerSeats: normalizeViewerSeats(session.authorizedViewerSeats),
    attachmentGeneration: session.attachmentGeneration,
    preferredViewerDisplayName: session.preferredViewerDisplayName,
    effectiveViewerDisplayName: session.effectiveViewerDisplayName,
    viewVersion: session.viewVersion,
    joinedAt: session.joinedAt,
    lastSeenAt: session.lastSeenAt,
  };
}

function buildSpectatorViewState(
  link: OnlineSpectatorLinkState,
  session: OnlineSpectatorSessionState
): OnlineSpectatorMatchSnapshot['spectatorView'] {
  if (!session.viewerSeat) {
    throw new Error('观战会话缺少当前对局席位');
  }
  return {
    currentViewerSeat: session.viewerSeat,
    authorizedViewerSeats: normalizeViewerSeats(link.authorizedViewerSeats),
    roomCode: link.roomCode,
    roomGeneration: link.roomGeneration,
    attachmentGeneration: session.attachmentGeneration,
    preferredViewerDisplayName: session.preferredViewerDisplayName,
    effectiveViewerDisplayName: session.effectiveViewerDisplayName,
    viewVersion: session.viewVersion,
    authorizationNotice: session.authorizationNotice,
  };
}

function buildSpectatorWaitingView(
  link: OnlineSpectatorLinkState,
  session: OnlineSpectatorSessionState
): OnlineSpectatorWaitingView {
  if (link.source !== 'ROOM_CODE' || !link.roomGeneration || !session.previousMatchId) {
    throw new Error('只有已从旧局解绑的房间号观战会话可以进入局间等待');
  }
  return {
    status: 'WAITING_NEXT_MATCH',
    roomCode: link.roomCode,
    roomGeneration: link.roomGeneration,
    attachmentGeneration: session.attachmentGeneration,
    previousMatchId: session.previousMatchId,
    preferredViewerDisplayName: session.preferredViewerDisplayName,
    effectiveViewerDisplayName: session.effectiveViewerDisplayName,
    retryAfterMs: SPECTATOR_WAITING_RETRY_AFTER_MS,
  };
}

function buildSpectatorAuthorizationClosedMessage(
  closedViewerSeats: readonly Seat[],
  autoSwitched: boolean
): string {
  const closedLabels = closedViewerSeats.map((seat) => (seat === 'FIRST' ? '先攻' : '后攻'));
  const closedText = closedLabels.join('、');
  return autoSwitched
    ? `${closedText}视角的观战授权已关闭，已自动切换到仍开放的视角`
    : `${closedText}视角的观战授权已关闭`;
}

function normalizeViewerSeats(seats: Iterable<Seat>): Seat[] {
  const seatSet = new Set(seats);
  return (['FIRST', 'SECOND'] as const).filter((seat) => seatSet.has(seat));
}

function replaceAuthorizedViewerSeats(target: Set<Seat>, seats: Iterable<Seat>): void {
  target.clear();
  for (const seat of normalizeViewerSeats(seats)) {
    target.add(seat);
  }
}

function replaceStringSet(target: Set<string>, values: Iterable<string>): void {
  target.clear();
  for (const value of values) {
    target.add(value);
  }
}

function endSpectatorSession(
  session: OnlineSpectatorSessionState,
  reason: NonNullable<OnlineSpectatorSessionState['endReason']>,
  now: number
): void {
  if (session.endedAt !== null) {
    return;
  }
  session.endedAt = now;
  session.endReason = reason;
}

function getSpectatorLinkEndError(reason: NonNullable<OnlineSpectatorLinkState['revokedReason']>): {
  readonly code: string;
  readonly message: string;
} {
  switch (reason) {
    case 'ROOM_CODE_AUTHORIZATION_CLOSED':
      return {
        code: 'ONLINE_SPECTATOR_AUTHORIZATION_CLOSED',
        message: '房间号观战授权已关闭，请返回首页重新输入房间号',
      };
    case 'ROOM_REPLACED':
      return {
        code: 'ONLINE_SPECTATOR_ROOM_REPLACED',
        message: '原房间已失效，相同房间号的新房间不会继承本次观战资格',
      };
    case 'ROOM_CLOSED':
      return {
        code: 'ONLINE_SPECTATOR_ROOM_CLOSED',
        message: '房间已关闭，本次观战已结束',
      };
  }
}

function buildRejectedCommandSummary(
  command: GameCommand | undefined,
  commandRecord: { readonly commandType?: string; readonly error?: string } | undefined
): string {
  const commandType = commandRecord?.commandType ?? command?.type ?? 'UNKNOWN_COMMAND';
  const reason = commandRecord?.error?.trim();
  return reason ? `命令被拒绝：${commandType}；原因：${reason}` : `命令被拒绝：${commandType}`;
}

function shouldBuildDecisionRecordsForCommand(command: GameCommand): boolean {
  switch (command.type) {
    case GameCommandType.ACTIVATE_ABILITY:
    case GameCommandType.CONFIRM_EFFECT_STEP:
    case GameCommandType.MULLIGAN:
    case GameCommandType.SELECT_SUCCESS_LIVE:
    case GameCommandType.SET_LIVE_CARD:
      return true;
    default:
      return false;
  }
}

function shouldWriteAuthorityCheckpointForFrame(
  match: OnlineMatchState,
  frameType: AppendMatchRecordFrameInput['frameType'],
  options: {
    readonly command?: GameCommand;
    readonly cursorLastTimelineSeq: number;
  }
): boolean {
  if (frameType === 'COMMAND_REJECTED') {
    return false;
  }
  if (frameType !== 'COMMAND_ACCEPTED') {
    return true;
  }

  if (isCheckpointCriticalCommand(options.command)) {
    return true;
  }

  if (match.session.state?.currentPhase === GamePhase.GAME_END) {
    return true;
  }

  const nextTimelineSeq = options.cursorLastTimelineSeq + 1;
  return nextTimelineSeq % DEFAULT_AUTHORITY_CHECKPOINT_INTERVAL_FRAMES === 0;
}

function isCheckpointCriticalCommand(command: GameCommand | undefined): boolean {
  if (!command) {
    return true;
  }

  switch (command.type) {
    case GameCommandType.ACTIVATE_ABILITY:
    case GameCommandType.CONFIRM_EFFECT_STEP:
    case GameCommandType.CONFIRM_PERFORMANCE_OUTCOME:
    case GameCommandType.CONFIRM_STEP:
    case GameCommandType.END_PHASE:
    case GameCommandType.MULLIGAN:
    case GameCommandType.SELECT_SUCCESS_LIVE:
    case GameCommandType.SET_LIVE_CARD:
    case GameCommandType.UNSET_LIVE_CARD:
    case GameCommandType.SUBMIT_JUDGMENT:
    case GameCommandType.SUBMIT_SCORE:
      return true;
    default:
      return false;
  }
}

function buildRecordStateSummary(
  state: GameState | null
): AppendMatchRecordFrameInput['stateSummary'] {
  if (!state) {
    return null;
  }

  return {
    turnCount: state.turnCount,
    phase: String(state.currentPhase),
    subPhase: String(state.currentSubPhase),
  };
}

function cloneRuntimeDeck(deck: DeckConfig): DeckConfig {
  return {
    mainDeck: [...deck.mainDeck],
    energyDeck: [...deck.energyDeck],
  };
}

function createRuntimeDeckSnapshot(
  seat: Seat,
  params: CreateOnlineMatchPlayerParams
): OnlineMatchDeckSnapshot {
  const deck = cloneRuntimeDeck(params.deck);
  return {
    seat,
    userId: params.userId,
    sourceDeckId: params.deckId ?? null,
    sourceDeckName: params.deckName ?? null,
    source: params.deckSource ?? 'ONLINE_RUNTIME_DECK',
    mainDeck: deck.mainDeck,
    energyDeck: deck.energyDeck,
    lockedAt: params.lockedAt ?? null,
  };
}

function toGameMode(value: MatchAutomationGameMode): GameMode {
  return value === 'SOLITAIRE' ? GameMode.SOLITAIRE : GameMode.DEBUG;
}

function getParticipantByUserId(
  match: OnlineMatchState,
  userId: string
): OnlineMatchParticipant | null {
  if (match.participants.FIRST.userId === userId) {
    return match.participants.FIRST;
  }
  if (match.participants.SECOND.userId === userId) {
    return match.participants.SECOND;
  }
  return null;
}

function findSeatByUserId(match: OnlineMatchState, userId: string | null | undefined): Seat | null {
  if (!userId) {
    return null;
  }
  if (match.participants.FIRST.userId === userId) {
    return 'FIRST';
  }
  if (match.participants.SECOND.userId === userId) {
    return 'SECOND';
  }
  return null;
}

function getSeatByPlayerId(
  match: OnlineMatchState,
  playerId: string | null | undefined
): Seat | null {
  if (!playerId) {
    return null;
  }
  if (match.participants.FIRST.playerId === playerId) {
    return 'FIRST';
  }
  if (match.participants.SECOND.playerId === playerId) {
    return 'SECOND';
  }
  return null;
}

function incrementRemoteRevision(match: OnlineMatchState): void {
  match.remoteRevision += 1;
}

function buildManualOperationIdempotencyKey(
  userId: string,
  idempotencyKey: string | null
): string | null {
  return idempotencyKey ? `${userId}:${idempotencyKey}` : null;
}

function readManualOperationIdempotencyStatus(
  match: OnlineMatchState,
  key: string | null,
  signature: string
): 'MATCH' | 'CONFLICT' | null {
  if (!key) {
    return null;
  }
  const recorded = match.appliedManualOperationKeys?.get(key);
  if (recorded === undefined) {
    return null;
  }
  return recorded === signature ? 'MATCH' : 'CONFLICT';
}

function recordManualOperationIdempotency(
  match: OnlineMatchState,
  key: string | null,
  signature: string
): void {
  if (!key) {
    return;
  }
  const keys = match.appliedManualOperationKeys ?? new Map<string, string>();
  keys.set(key, signature);
  match.appliedManualOperationKeys = keys;
}

function normalizePublicEventCursor(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildPublicEventsResponse(
  match: OnlineMatchState,
  afterSeq: number,
  requestKind: 'PARTICIPANT' | 'SPECTATOR'
): PublicEventsResponse {
  const currentPublicSeq = match.session.getCurrentPublicEventSeq();
  const slice = match.session.getPublicEventsSliceSince(afterSeq, PUBLIC_EVENTS_RESPONSE_MAX);
  if (slice.truncated) {
    console.warn(
      JSON.stringify({
        event: 'online-public-events-truncated',
        matchId: match.matchId,
        matchMode: match.matchMode,
        requestKind,
        afterSeq,
        currentPublicSeq,
        returnedEventCount: slice.publicEvents.length,
        droppedEventCount: slice.droppedEventCount,
        maxBatch: PUBLIC_EVENTS_RESPONSE_MAX,
      })
    );
  }

  return {
    matchId: match.matchId,
    currentPublicSeq,
    publicEvents: slice.publicEvents,
    ...(slice.truncated
      ? {
          truncated: true,
          droppedEventCount: slice.droppedEventCount,
        }
      : {}),
  };
}

function deriveRemoteUndoPolicy(
  match: OnlineMatchState,
  participant: OnlineMatchParticipant
): UndoPolicy {
  if (
    match.matchMode === 'SOLITAIRE' &&
    participant.seat === 'FIRST' &&
    participant.participantKind === 'USER'
  ) {
    return 'REMOTE_IMMEDIATE';
  }
  if (match.matchMode === 'ONLINE' && participant.participantKind === 'USER') {
    if (hasFormalAiOpponent(match, participant)) {
      return 'NONE';
    }
    return 'REMOTE_REQUEST';
  }
  return 'NONE';
}

function hasFormalAiOpponent(
  match: OnlineMatchState,
  participant: OnlineMatchParticipant
): boolean {
  const opponentSeat = getOpponentSeat(participant.seat);
  return (
    isFormalAiMatch(match) &&
    match.participants[opponentSeat].participantKind === 'SYSTEM' &&
    !!match.systemParticipantBindings[opponentSeat]
  );
}

function buildMachineStrategyRuntimeKey(matchId: string, seat: Seat): string {
  return `${matchId}:${seat}`;
}

function buildAiStrategyMatchDecisionRecord(
  strategyRecord: AiStrategyDecisionRecord
): MatchDecisionRecordInput {
  return {
    decisionId: `ai-strategy:${strategyRecord.contractIdentity.decisionIdSha256}`,
    decisionType: 'AI_STRATEGY_SUBMITTED',
    status: 'SUBMITTED',
    waitingSeat: strategyRecord.decisionAudit.seat,
    visibleContextSummary: {
      selectableCardCount: strategyRecord.decisionAudit.consideredIds.length,
      hasPrivateCandidates: false,
    },
    resultSummary: `${strategyRecord.decisionAudit.tier}:${strategyRecord.decisionAudit.reasonCode}`,
    replayCapability: 'DECISION_RECORDS_PARTIAL',
    transitionSemantics: 'SNAPSHOT_AUDIT_ONLY',
    strategyRecord,
  };
}

function assertSystemParticipantBinding(player: CreateOnlineMatchPlayerParams): void {
  const binding = player.systemParticipantBinding;
  if (player.participantKind !== 'SYSTEM') {
    if (!binding) return;
    throw new OnlineMatchServiceError(
      'ONLINE_MATCH_INVALID_SYSTEM_BINDING',
      '非 SYSTEM 参赛者不能携带 SYSTEM 身份绑定'
    );
  }
  if (!binding) {
    throw new OnlineMatchServiceError(
      'ONLINE_MATCH_INVALID_SYSTEM_BINDING',
      '正式 ONLINE SYSTEM 参赛者必须携带完整认证身份绑定'
    );
  }
  if (
    binding.participantKind !== 'SYSTEM' ||
    binding.loginAllowed ||
    binding.userId !== player.userId ||
    !isCertifiedAiSystemParticipantBinding(binding) ||
    player.deckSource !== 'AI_CERTIFIED_DECK'
  ) {
    throw new OnlineMatchServiceError(
      'ONLINE_MATCH_INVALID_SYSTEM_BINDING',
      'SYSTEM 身份绑定与对局参赛者不一致'
    );
  }
}

function assertSystemParticipantConfiguration(
  first: CreateOnlineMatchPlayerParams,
  second: CreateOnlineMatchPlayerParams,
  matchMode: MatchMode,
  originKind: MatchOriginKind
): void {
  const players = [first, second] as const;
  const systemPlayers = players.filter((player) => player.participantKind === 'SYSTEM');
  if (matchMode === 'SOLITAIRE') {
    if (players.some((player) => !!player.systemParticipantBinding)) {
      throw new OnlineMatchServiceError(
        'ONLINE_MATCH_INVALID_SYSTEM_BINDING',
        '单人对墙打 SYSTEM 不使用正式 AI 对战身份绑定'
      );
    }
    return;
  }
  if (systemPlayers.length === 0) {
    if (originKind === 'AI_BATTLE') {
      throw new OnlineMatchServiceError(
        'ONLINE_MATCH_INVALID_SYSTEM_BINDING',
        'AI_BATTLE 必须包含一个正式 SYSTEM 参赛者'
      );
    }
    for (const player of players) assertSystemParticipantBinding(player);
    return;
  }
  if (matchMode !== 'ONLINE' || originKind !== 'AI_BATTLE' || systemPlayers.length !== 1) {
    throw new OnlineMatchServiceError(
      'ONLINE_MATCH_INVALID_SYSTEM_BINDING',
      'ONLINE SYSTEM 只能用于单一正式 AI_BATTLE 对手席位'
    );
  }
  for (const player of players) assertSystemParticipantBinding(player);
}

function assertRestoredSystemParticipantConfiguration(match: OnlineMatchState): void {
  const players = (['FIRST', 'SECOND'] as const).map((seat) => ({
    userId: match.participants[seat].userId,
    displayName: match.participants[seat].displayName,
    deck: {
      mainDeck: match.deckSnapshots[seat].mainDeck,
      energyDeck: match.deckSnapshots[seat].energyDeck,
    },
    deckSource: match.deckSnapshots[seat].source,
    participantKind: match.participants[seat].participantKind,
    systemParticipantBinding: match.systemParticipantBindings[seat] ?? null,
  }));
  assertSystemParticipantConfiguration(players[0], players[1], match.matchMode, match.originKind);
}

function isFormalAiMatch(match: OnlineMatchState): boolean {
  if (match.matchMode !== 'ONLINE' || match.originKind !== 'AI_BATTLE') return false;
  const systemSeats = (['FIRST', 'SECOND'] as const).filter(
    (seat) => match.participants[seat].participantKind === 'SYSTEM'
  );
  if (systemSeats.length !== 1) return false;
  const systemSeat = systemSeats[0]!;
  const binding = match.systemParticipantBindings[systemSeat];
  return (
    !!binding &&
    binding.userId === match.participants[systemSeat].userId &&
    isCertifiedAiSystemParticipantBinding(binding)
  );
}

function buildOnlineUndoView(
  match: OnlineMatchState,
  participant: OnlineMatchParticipant
): OnlineUndoView {
  const policy = deriveRemoteUndoPolicy(match, participant);
  const base = match.session.getUndoAvailability(participant.playerId, policy);
  const grant = match.activeUndoGrant
    ? {
        grantId: match.activeUndoGrant.grantId,
        requesterSeat: match.activeUndoGrant.requesterSeat,
        grantorSeat: match.activeUndoGrant.grantorSeat,
        boundaryKey: match.activeUndoGrant.boundaryKey,
        expiresAt: new Date(match.activeUndoGrant.expiresAt).toISOString(),
      }
    : null;
  const pendingRequest = match.pendingUndoRequest
    ? {
        requestId: match.pendingUndoRequest.requestId,
        requesterSeat: match.pendingUndoRequest.requesterSeat,
        targetUndoEntryId: match.pendingUndoRequest.targetUndoEntryId,
        targetRevision: match.pendingUndoRequest.targetRevision,
        summary: match.pendingUndoRequest.summary,
        expiresAt: new Date(match.pendingUndoRequest.expiresAt).toISOString(),
      }
    : null;

  if (match.pendingManualOperationModeRequest) {
    return {
      ...base,
      canUndoNow: false,
      disabledReason: '请先处理当前自由模式请求',
      pendingRequest,
      grant,
    };
  }

  if (!pendingRequest) {
    return {
      ...base,
      grant,
    };
  }

  return {
    ...base,
    canUndoNow: false,
    disabledReason: '已有撤销请求待处理',
    pendingRequest,
    grant,
  };
}

function getUsableUndoGrant(
  match: OnlineMatchState,
  participant: OnlineMatchParticipant,
  entry: UndoEntrySummary | null
): OnlineUndoGrantState | null {
  const grant = match.activeUndoGrant;
  if (!grant || !entry) {
    return null;
  }
  if (grant.requesterSeat !== participant.seat || grant.requesterUserId !== participant.userId) {
    return null;
  }
  if (grant.boundaryKey !== entry.boundaryKey) {
    return null;
  }
  return grant;
}

function getOpponentSeat(seat: Seat): Seat {
  return seat === 'FIRST' ? 'SECOND' : 'FIRST';
}

function buildMachineLivenessConcessionNotice(
  reason: NonNullable<MachineLivenessState['terminalReason']>
): string {
  switch (reason) {
    case 'AI_TURNS_WITHOUT_STRATEGIC_PROGRESS':
      return 'AI 连续几个回合没有让牌局继续推进，因此已认输。';
    case 'CONSERVATIVE_DECISION_LIMIT':
      return 'AI 已用完本局可进行的稳妥操作次数，因此已认输。';
    case 'DEGRADED_DURATION_LIMIT':
      return 'AI 长时间无法恢复正常选择，因此已认输。';
    case 'AUTHORITY_PROGRESS_WATCHDOG':
      return 'AI 连续多次没有让牌局继续推进，因此已认输。';
  }
}

function getCompletedMatchRecordStatus(
  authorityState: GameState | null
): Exclude<MatchRecordStatus, 'IN_PROGRESS'> {
  return authorityState?.endInfo?.reason === GameEndReason.OPPONENT_SURRENDER ||
    authorityState?.endInfo?.reason === GameEndReason.SYSTEM_LIVENESS_CONCEDE
    ? 'SURRENDERED'
    : 'COMPLETED';
}

function buildUndoRequestSettlementKey(
  action: 'accept' | 'reject',
  requestId: string,
  userId: string,
  idempotencyKey: string
): string {
  return `undo-request:${action}:${requestId}:${userId}:${idempotencyKey}`;
}

function normalizeOptionalKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSpectatorToken(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSpectatorDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 24);
}

function normalizeSpectatorClientId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 128);
}

function isSpectatorSessionActive(session: OnlineSpectatorSessionState, now: number): boolean {
  return session.endedAt === null && now - session.lastSeenAt <= SPECTATOR_SESSION_STALE_MS;
}

function buildRemoteFrameDedupeKey(
  match: OnlineMatchState,
  frameType: AppendMatchRecordFrameInput['frameType'],
  refs: {
    readonly relatedPublicSeq: number | null;
    readonly relatedCommandSeq: number | null;
    readonly relatedGameEventSeq: number | null;
  }
): string {
  return [
    match.recordBranchId,
    frameType,
    `revision:${match.remoteRevision}`,
    `public:${refs.relatedPublicSeq ?? 0}`,
    `command:${refs.relatedCommandSeq ?? 0}`,
    `game-event:${refs.relatedGameEventSeq ?? 0}`,
  ].join(':');
}

function touchMatch(match: OnlineMatchState): void {
  const now = Date.now();
  match.updatedAt = now;
  match.lastActivityAt = now;
}

function latestSeq<T>(items: readonly T[], getSeq: (item: T) => number): number | null {
  const last = items.at(-1);
  return last ? getSeq(last) : null;
}

function maxNullable(...values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
