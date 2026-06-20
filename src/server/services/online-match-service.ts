import { randomUUID } from 'node:crypto';
import { createGameSession, type GameSession } from '../../application/game-session.js';
import type { GameCommand } from '../../application/game-commands.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { AnyCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { projectPlayerViewState } from '../../online/projector.js';
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
  OnlineUndoView,
  Seat,
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
  readonly appliedUndoKeys: Set<string>;
  updatedAt: number;
  lastActivityAt: number;
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

export interface CreateUndoRequestInput extends RemoteUndoInput {}

export interface RespondUndoRequestInput {
  readonly expectedRevision: number;
  readonly idempotencyKey?: string | null;
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

export class OnlineMatchService {
  private readonly matches = new Map<string, OnlineMatchState>();
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
      appliedUndoKeys: new Set<string>(),
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
    touchMatch(match);
    const currentSeq = match.remoteRevision;
    if (options.sinceSeq !== undefined && options.sinceSeq >= currentSeq) {
      return {
        matchId: match.matchId,
        seq: currentSeq,
        modified: false,
      };
    }

    return buildSnapshot(match, participant);
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

    const beforeState = match.session.getAuthoritySnapshotForRecord();
    const commandWithPlayer: GameCommand = {
      ...command,
      playerId: participant.playerId,
    };
    const result = match.session.executeCommand(commandWithPlayer);
    const afterState = match.session.getAuthoritySnapshotForRecord();
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

    await this.sealCompletedMatchIfNeeded(match);

    return {
      success: true,
      snapshot: buildSnapshot(match, participant),
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

    await this.sealCompletedMatchIfNeeded(match);

    return {
      success: true,
      snapshot: buildSnapshot(match, participant),
    };
  }

  getUndoAvailability(
    matchId: string,
    userId: string,
    policy?: UndoPolicy
  ): OnlineUndoView | null {
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

    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const appliedUndoKey = idempotencyKey
      ? `${input.undoEntryId}:${idempotencyKey}`
      : null;
    if (appliedUndoKey && match.appliedUndoKeys.has(appliedUndoKey)) {
      touchMatch(match);
      return {
        success: true,
        snapshot: buildSnapshot(match, participant),
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

    const undoResult = match.session.undoLastStepForPlayer(
      participant.playerId,
      input.undoEntryId
    );
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

    return {
      success: true,
      snapshot: buildSnapshot(match, participant),
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
        snapshot: buildSnapshot(match, participant),
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
      snapshot: buildSnapshot(match, participant),
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
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const acceptedUndoKey = idempotencyKey
      ? buildUndoRequestSettlementKey('accept', requestId, participant.userId, idempotencyKey)
      : null;
    if (acceptedUndoKey && match.appliedUndoKeys.has(acceptedUndoKey)) {
      touchMatch(match);
      return {
        success: true,
        snapshot: buildSnapshot(match, participant),
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
    incrementRemoteRevision(match);
    touchMatch(match);
    await this.appendSessionRecordFrame(match, 'UNDO_ACCEPTED', {
      summary: `接受撤销请求：${request.summary}`,
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
      snapshot: buildSnapshot(match, participant),
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
    const idempotencyKey = normalizeOptionalKey(input.idempotencyKey);
    const rejectedUndoKey = idempotencyKey
      ? buildUndoRequestSettlementKey('reject', requestId, participant.userId, idempotencyKey)
      : null;
    if (rejectedUndoKey && match.appliedUndoKeys.has(rejectedUndoKey)) {
      touchMatch(match);
      return {
        success: true,
        snapshot: buildSnapshot(match, participant),
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
      snapshot: buildSnapshot(match, participant),
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
    this.sealedMatchIds.delete(matchId);
    this.partialRecordMatchIds.delete(matchId);
    return true;
  }

  async cleanupExpiredMatches(
    activeMatchIds: ReadonlySet<string>,
    now = Date.now()
  ): Promise<void> {
    for (const [matchId, match] of this.matches) {
      if (activeMatchIds.has(matchId)) {
        continue;
      }

      if (now - match.lastActivityAt > MATCH_STALE_TTL_MS) {
        await this.deleteMatch(matchId, {
          reason: 'STALE_MATCH_CLEANUP',
          now,
        });
      }
    }
  }

  clear(): void {
    this.matches.clear();
    this.sealedMatchIds.clear();
    this.partialRecordMatchIds.clear();
  }

  private async expirePendingUndoRequestIfNeeded(match: OnlineMatchState): Promise<void> {
    const request = match.pendingUndoRequest;
    if (!request || request.expiresAt > this.now()) {
      return;
    }
    await this.expirePendingUndoRequest(match, '撤销请求已超时');
  }

  private async expirePendingUndoRequest(
    match: OnlineMatchState,
    summary: string
  ): Promise<void> {
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

      const authorityState = match.session.getAuthoritySnapshotForRecord();
      await this.recorder.appendMatchRecordFrame({
        matchId: match.matchId,
        frameType,
        summary: options.summary,
        authorityState,
        writeAuthorityCheckpoint:
          options.writeAuthorityCheckpoint ?? frameType !== 'COMMAND_REJECTED',
        relatedPublicSeq:
          latestSeq(publicEvents, (event) => event.seq) ?? match.session.getCurrentPublicEventSeq(),
        relatedPrivateSeq: maxNullable(
          latestSeq(firstPrivateEvents, (event) => event.seq),
          latestSeq(secondPrivateEvents, (event) => event.seq)
        ),
        relatedAuditSeq: latestSeq(sealedAudit, (record) => record.seq),
        relatedCommandSeq: latestSeq(commandLog, (record) => record.seq),
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
            relatedCommandSeq: latestSeq(commandLog, (record) => record.seq),
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
  participant: OnlineMatchParticipant
): OnlineMatchSnapshot {
  const authorityState = match.session.getAuthoritySnapshotForRecord();
  if (!authorityState) {
    throw new Error('联机玩家视图不存在');
  }
  const projectedViewState = projectPlayerViewState(authorityState, participant.playerId, {
    seq: match.remoteRevision,
    gameMode: match.session.gameMode,
  });
  const playerViewState = {
    ...projectedViewState,
    match: {
      ...projectedViewState.match,
      undo: buildOnlineUndoView(match, participant),
    },
  };

  return {
    matchId: match.matchId,
    seat: participant.seat,
    playerId: participant.playerId,
    seq: match.remoteRevision,
    playerViewState,
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
    return base;
  }

  return {
    ...base,
    canUndoNow: false,
    disabledReason: '已有撤销请求待处理',
    pendingRequest,
  };
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
