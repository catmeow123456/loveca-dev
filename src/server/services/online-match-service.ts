import { randomUUID } from 'node:crypto';
import {
  createGameSession,
  type GameSession,
  type GameSessionRuntimeStats,
} from '../../application/game-session.js';
import { GameCommandType, type GameCommand } from '../../application/game-commands.js';
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
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  OnlineSpectatorJoinView,
  OnlineSpectatorLinkView,
  OnlineSpectatorPresenceView,
  OnlineSpectatorSessionView,
  OnlineSpectatorSnapshotResponse,
  OnlineUndoView,
  PublicEvent,
  PublicEventsResponse,
  RuntimeRecoveryInfo,
  Seat,
  UndoEntrySummary,
  UndoPolicy,
  UndoRuntimeCaptureCursor,
} from '../../online/index.js';
import { GameMode, GamePhase } from '../../shared/types/enums.js';
import {
  buildMatchRecorderBeginInputFromOnlineMatch,
  matchRecorderService,
  type MatchRecorderService,
  type MatchDecisionRecordInput,
  type AppendMatchRecordFrameInput,
} from './match-recorder-service.js';
import {
  buildMatchDecisionRecordsForCommand,
  buildMatchDecisionRecordsForStateTransition,
} from './match-decision-records.js';

const MATCH_STALE_TTL_MS = 30 * 60 * 1000;
const UNDO_REQUEST_TTL_MS = 60 * 1000;
const SPECTATOR_LINK_TTL_MS = 12 * 60 * 60 * 1000;
const SPECTATOR_SESSION_STALE_MS = 15 * 1000;
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
  readonly startedAt: number;
  remoteRevision: number;
  recordBranchId: string;
  recordCaptureCursor: UndoRuntimeCaptureCursor;
  pendingUndoRequest: OnlineUndoRequestState | null;
  activeUndoGrant: OnlineUndoGrantState | null;
  readonly appliedUndoKeys: Set<string>;
  recoveryNotice:
    | (RuntimeRecoveryInfo & {
        readonly publicEvents: readonly PublicEvent[];
        readonly truncated: boolean;
        readonly droppedEventCount: number;
      })
    | null;
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
  readonly matchId: string;
  readonly viewType: 'PLAYER';
  readonly viewerSeat: Seat;
  readonly createdByUserId: string;
  readonly source: 'PLAYER_LINK' | 'ADMIN_LINK' | 'ROOM_CODE';
  readonly countsInPresence: boolean;
  readonly createdAt: number;
  readonly expiresAt: number;
  revokedAt: number | null;
}

interface OnlineSpectatorSessionState {
  readonly sessionId: string;
  readonly token: string;
  readonly clientId: string | null;
  readonly matchId: string;
  readonly viewType: 'PLAYER';
  readonly viewerSeat: Seat;
  readonly countsInPresence: boolean;
  readonly joinedAt: number;
  displayName: string;
  lastSeenAt: number;
}

export interface CreateUndoRequestInput extends RemoteUndoInput {}

export interface RespondUndoRequestInput {
  readonly expectedRevision: number;
  readonly idempotencyKey?: string | null;
  readonly grantContinuous?: boolean;
}

interface OnlineMatchServiceDeps {
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
}

export interface DeleteOnlineMatchOptions {
  readonly reason?: string;
  readonly now?: number;
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

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'OnlineSpectatorServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class OnlineMatchService {
  private readonly matches = new Map<string, OnlineMatchState>();
  private readonly spectatorLinks = new Map<string, OnlineSpectatorLinkState>();
  private readonly spectatorSessions = new Map<string, OnlineSpectatorSessionState>();
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
  private readonly sealedMatchIds = new Set<string>();
  private readonly partialRecordMatchIds = new Set<string>();
  private serviceRejectedAttemptSeq = 0;

  constructor(deps: OnlineMatchServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.idGenerator = deps.idGenerator ?? randomUUID;
    this.recorder = deps.recorder === undefined ? matchRecorderService : deps.recorder;
  }

  async createMatch(params: CreateOnlineMatchParams): Promise<OnlineMatchState> {
    const matchId = this.idGenerator();
    const automationGameMode = params.automationGameMode ?? 'DEBUG';
    const session = createGameSession({ gameMode: toGameMode(automationGameMode) });
    const firstPlayerId = `${matchId}:FIRST:${params.first.userId}`;
    const secondPlayerId = `${matchId}:SECOND:${params.second.userId}`;
    const now = params.startedAt ?? this.now();
    const state: OnlineMatchState = {
      matchId,
      roomCode: params.roomCode,
      matchMode: params.matchMode ?? 'ONLINE',
      automationGameMode,
      originKind: params.originKind ?? 'ONLINE_ROOM',
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
      activeUndoGrant: null,
      appliedUndoKeys: new Set<string>(),
      recoveryNotice: null,
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
    return state;
  }

  getMatch(matchId: string): OnlineMatchState | null {
    return this.matches.get(matchId) ?? null;
  }

  async restoreMatch(match: OnlineMatchState): Promise<OnlineMatchState> {
    const existing = this.matches.get(match.matchId);
    if (existing) {
      return existing;
    }

    this.sealedMatchIds.delete(match.matchId);
    this.matches.set(match.matchId, match);
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
    touchMatch(match);
    const afterSeq = normalizePublicEventCursor(options.afterSeq);
    return buildPublicEventsResponse(match, afterSeq, 'PARTICIPANT');
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

  async createPlayerViewSpectatorLink(
    matchId: string,
    userId: string
  ): Promise<OnlineSpectatorLinkView | null> {
    const match = this.matches.get(matchId);
    if (!match || match.matchMode !== 'ONLINE') {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    return this.createPlayerViewSpectatorLinkForSeat(match, participant.seat, userId, {
      source: 'PLAYER_LINK',
      countsInPresence: true,
    });
  }

  async createAdminPlayerViewSpectatorLink(
    matchId: string,
    adminUserId: string,
    viewerSeat: Seat
  ): Promise<OnlineSpectatorLinkView | null> {
    const match = this.matches.get(matchId);
    if (!match || match.matchMode !== 'ONLINE' || !match.participants[viewerSeat]) {
      return null;
    }

    return this.createPlayerViewSpectatorLinkForSeat(match, viewerSeat, adminUserId, {
      source: 'ADMIN_LINK',
      countsInPresence: false,
    });
  }

  createRoomCodePlayerViewSpectatorLink(
    matchId: string,
    viewerSeat: Seat
  ): OnlineSpectatorLinkView | null {
    const match = this.matches.get(matchId);
    if (!match || match.matchMode !== 'ONLINE' || !match.participants[viewerSeat]) {
      return null;
    }

    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const existingLink = [...this.spectatorLinks.values()].find(
      (link) =>
        link.source === 'ROOM_CODE' &&
        link.matchId === match.matchId &&
        link.viewerSeat === viewerSeat &&
        link.revokedAt === null &&
        link.expiresAt > now
    );
    if (existingLink) {
      touchMatch(match);
      return buildSpectatorLinkView(existingLink);
    }

    return this.createPlayerViewSpectatorLinkForSeat(match, viewerSeat, 'room-code-entry', {
      source: 'ROOM_CODE',
      countsInPresence: true,
    });
  }

  revokeRoomCodeSpectatorAccess(matchId: string, viewerSeat: Seat): void {
    const now = this.now();
    const revokedTokens = new Set<string>();
    for (const link of this.spectatorLinks.values()) {
      if (
        link.source === 'ROOM_CODE' &&
        link.matchId === matchId &&
        link.viewerSeat === viewerSeat &&
        link.revokedAt === null
      ) {
        link.revokedAt = now;
        revokedTokens.add(link.token);
      }
    }

    if (revokedTokens.size === 0) {
      return;
    }

    for (const [sessionId, session] of this.spectatorSessions) {
      if (revokedTokens.has(session.token)) {
        this.spectatorSessions.delete(sessionId);
      }
    }

    const match = this.matches.get(matchId);
    if (match) {
      touchMatch(match);
    }
  }

  private createPlayerViewSpectatorLinkForSeat(
    match: OnlineMatchState,
    viewerSeat: Seat,
    createdByUserId: string,
    options: {
      readonly source: OnlineSpectatorLinkState['source'];
      readonly countsInPresence: boolean;
    }
  ): OnlineSpectatorLinkView {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const link: OnlineSpectatorLinkState = {
      token: this.idGenerator(),
      matchId: match.matchId,
      viewType: 'PLAYER',
      viewerSeat,
      createdByUserId,
      source: options.source,
      countsInPresence: options.countsInPresence,
      createdAt: now,
      expiresAt: now + SPECTATOR_LINK_TTL_MS,
      revokedAt: null,
    };
    this.spectatorLinks.set(link.token, link);
    touchMatch(match);

    return buildSpectatorLinkView(link);
  }

  async joinSpectatorLink(
    tokenInput: string,
    input: { readonly displayName?: string | null; readonly clientId?: string | null } = {}
  ): Promise<OnlineSpectatorJoinView> {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    const clientId = normalizeSpectatorClientId(input.clientId);
    const displayName = normalizeSpectatorDisplayName(input.displayName);
    const existingSession = clientId
      ? this.findActiveSpectatorSessionByClientId(link.token, clientId, now)
      : null;

    if (existingSession) {
      existingSession.lastSeenAt = now;
      if (displayName) {
        existingSession.displayName = displayName;
      }
      touchMatch(match);

      return {
        link: buildSpectatorLinkView(link),
        session: buildSpectatorSessionView(existingSession),
        snapshot: buildReadonlySpectatorSnapshot(match, link.viewerSeat),
      };
    }

    const session: OnlineSpectatorSessionState = {
      sessionId: this.idGenerator(),
      token: link.token,
      clientId,
      matchId: link.matchId,
      viewType: link.viewType,
      viewerSeat: link.viewerSeat,
      countsInPresence: link.countsInPresence,
      displayName: displayName ?? this.createGuestDisplayName(link.matchId, now),
      joinedAt: now,
      lastSeenAt: now,
    };
    this.spectatorSessions.set(session.sessionId, session);
    touchMatch(match);

    return {
      link: buildSpectatorLinkView(link),
      session: buildSpectatorSessionView(session),
      snapshot: buildReadonlySpectatorSnapshot(match, link.viewerSeat),
    };
  }

  async getSpectatorSnapshot(
    tokenInput: string,
    sessionId: string | null | undefined,
    options: { readonly sinceSeq?: number } = {}
  ): Promise<OnlineSpectatorSnapshotResponse> {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    this.touchSpectatorSession(link.token, sessionId, now);

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    touchMatch(match);

    const currentSeq = match.remoteRevision;
    if (options.sinceSeq !== undefined && options.sinceSeq >= currentSeq) {
      return {
        matchId: match.matchId,
        seq: currentSeq,
        currentPublicSeq: match.session.getCurrentPublicEventSeq(),
        modified: false,
      };
    }

    return buildReadonlySpectatorSnapshot(match, link.viewerSeat);
  }

  async getSpectatorPublicEvents(
    tokenInput: string,
    sessionId: string | null | undefined,
    options: { readonly afterSeq?: number } = {}
  ): Promise<PublicEventsResponse> {
    const now = this.now();
    this.cleanupExpiredSpectatorState(now);
    const { link, match } = this.requireActiveSpectatorLink(tokenInput, now);
    this.touchSpectatorSession(link.token, sessionId, now);

    await this.expirePendingUndoRequestIfNeeded(match);
    await this.expireActiveUndoGrantIfNeeded(match);
    touchMatch(match);
    const afterSeq = normalizePublicEventCursor(options.afterSeq);
    return buildPublicEventsResponse(match, afterSeq, 'SPECTATOR');
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

  async executeCommand(
    matchId: string,
    userId: string,
    command: GameCommand
  ): Promise<OnlineCommandResult | null> {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    const commandWithPlayer: GameCommand = {
      ...command,
      playerId: participant.playerId,
    };
    const shouldBuildDecisionRecords = shouldBuildDecisionRecordsForCommand(commandWithPlayer);
    const beforeState = shouldBuildDecisionRecords
      ? match.session.getAuthoritySnapshotForRecord()
      : null;
    const result = match.session.executeCommand(commandWithPlayer);
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
      incrementRemoteRevision(match);
    }
    await this.appendSessionRecordFrame(
      match,
      result.success ? 'COMMAND_ACCEPTED' : 'COMMAND_REJECTED',
      {
        command: commandWithPlayer,
        authorityState: afterState,
        decisionRecords,
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

    const beforeState = match.session.getAuthoritySnapshotForRecord();
    const result = match.session.advancePhase();
    const afterState = match.session.getAuthoritySnapshotForRecord();
    const decisionRecords = buildMatchDecisionRecordsForStateTransition({
      matchId: match.matchId,
      beforeState,
      afterState,
      getSeatForPlayer: (playerId) => getSeatByPlayerId(match, playerId),
    });
    touchMatch(match);
    if (result.success) {
      incrementRemoteRevision(match);
    }
    await this.appendSessionRecordFrame(
      match,
      result.success ? 'SYSTEM_TRANSITION' : 'COMMAND_REJECTED',
      {
        summary: result.success ? '阶段推进后保存权威检查点' : '阶段推进被规则层拒绝',
        force: true,
        writeAuthorityCheckpoint: result.success,
        decisionRecords: result.success ? decisionRecords : [],
      }
    );
    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    if (match.pendingUndoRequest) {
      await this.expirePendingUndoRequest(match, '阶段已推进，撤销请求失效');
    }
    if (match.activeUndoGrant) {
      await this.expireActiveUndoGrant(match, '阶段已推进，连续撤销授权失效');
    }

    await this.sealCompletedMatchIfNeeded(match);

    return {
      success: true,
      snapshot: this.buildSnapshotForParticipant(match, participant),
    };
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
    incrementRemoteRevision(match);
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

    incrementRemoteRevision(match);
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
    incrementRemoteRevision(match);
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
    incrementRemoteRevision(match);
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
    incrementRemoteRevision(match);
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

  async deleteMatch(matchId: string, options: DeleteOnlineMatchOptions = {}): Promise<boolean> {
    const match = this.matches.get(matchId);
    if (!match) {
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

    this.matches.delete(matchId);
    for (const [token, link] of this.spectatorLinks) {
      if (link.matchId === matchId) {
        this.spectatorLinks.delete(token);
      }
    }
    for (const [sessionId, session] of this.spectatorSessions) {
      if (session.matchId === matchId) {
        this.spectatorSessions.delete(sessionId);
      }
    }
    this.sealedMatchIds.delete(matchId);
    this.partialRecordMatchIds.delete(matchId);
    return true;
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
    this.matches.clear();
    this.spectatorLinks.clear();
    this.spectatorSessions.clear();
    this.sealedMatchIds.clear();
    this.partialRecordMatchIds.clear();
  }

  private requireActiveSpectatorLink(
    tokenInput: string,
    now: number
  ): { readonly link: OnlineSpectatorLinkState; readonly match: OnlineMatchState } {
    const token = normalizeSpectatorToken(tokenInput);
    const link = token ? this.spectatorLinks.get(token) : undefined;
    if (!link || link.revokedAt !== null) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_LINK_NOT_FOUND',
        '观战链接不存在或已被撤销',
        404
      );
    }
    if (link.expiresAt <= now) {
      throw new OnlineSpectatorServiceError('ONLINE_SPECTATOR_LINK_EXPIRED', '观战链接已过期', 410);
    }

    const match = this.matches.get(link.matchId);
    if (!match) {
      throw new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_MATCH_NOT_FOUND',
        '观战对局不存在或已失效',
        404
      );
    }

    return { link, match };
  }

  private touchSpectatorSession(
    token: string,
    sessionId: string | null | undefined,
    now: number
  ): void {
    const normalizedSessionId = normalizeSpectatorToken(sessionId ?? '');
    if (!normalizedSessionId) {
      return;
    }

    const session = this.spectatorSessions.get(normalizedSessionId);
    if (!session || session.token !== token) {
      return;
    }

    session.lastSeenAt = now;
  }

  private cleanupExpiredSpectatorState(now: number): void {
    for (const [sessionId, session] of this.spectatorSessions) {
      if (!this.spectatorLinks.has(session.token) || !isSpectatorSessionActive(session, now)) {
        this.spectatorSessions.delete(sessionId);
      }
    }

    for (const [token, link] of this.spectatorLinks) {
      if (link.expiresAt <= now || link.revokedAt !== null || !this.matches.has(link.matchId)) {
        this.spectatorLinks.delete(token);
        for (const [sessionId, session] of this.spectatorSessions) {
          if (session.token === token) {
            this.spectatorSessions.delete(sessionId);
          }
        }
      }
    }
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

  private async expirePendingUndoRequest(match: OnlineMatchState, summary: string): Promise<void> {
    const request = match.pendingUndoRequest;
    if (!request) {
      return;
    }

    match.pendingUndoRequest = null;
    incrementRemoteRevision(match);
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
    incrementRemoteRevision(match);
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
      status: 'COMPLETED',
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
      status: completed ? 'COMPLETED' : 'INTERRUPTED',
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

export const onlineMatchService = new OnlineMatchService();

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
      undo: options.undoView ?? buildOnlineUndoView(match, participant),
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
  viewerSeat: Seat
): OnlineMatchSnapshot {
  return buildSnapshot(match, match.participants[viewerSeat], {
    undoView: buildReadonlyUndoView(),
  });
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

function buildSpectatorLinkView(link: OnlineSpectatorLinkState): OnlineSpectatorLinkView {
  return {
    token: link.token,
    matchId: link.matchId,
    viewType: link.viewType,
    viewerSeat: link.viewerSeat,
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
    joinedAt: session.joinedAt,
    lastSeenAt: session.lastSeenAt,
  };
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
    return 'REMOTE_REQUEST';
  }
  return 'NONE';
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
  return now - session.lastSeenAt <= SPECTATOR_SESSION_STALE_MS;
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
