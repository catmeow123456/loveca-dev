import { randomUUID } from 'node:crypto';
import { createGameSession, type GameSession } from '../../application/game-session.js';
import type { GameCommand } from '../../application/game-commands.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { AnyCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import type {
  MatchRecordCompleteness,
  MatchRecordStatus,
  OnlineAdminMatchSummary,
  OnlineCommandResult,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  Seat,
} from '../../online/index.js';
import { GamePhase } from '../../shared/types/enums.js';
import {
  buildMatchRecorderBeginInputFromOnlineMatch,
  matchRecorderService,
  type MatchRecorderService,
  type MatchDecisionRecordInput,
} from './match-recorder-service.js';
import {
  buildMatchDecisionRecordsForCommand,
  buildMatchDecisionRecordsForStateTransition,
} from './match-decision-records.js';

const MATCH_STALE_TTL_MS = 30 * 60 * 1000;

export interface OnlineMatchParticipant {
  readonly userId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: Seat;
}

export interface CreateOnlineMatchPlayerParams {
  readonly userId: string;
  readonly displayName: string;
  readonly deck: DeckConfig;
  readonly deckId?: string | null;
  readonly deckName?: string | null;
  readonly lockedAt?: number | null;
}

export interface CreateOnlineMatchParams {
  readonly roomCode: string;
  readonly startedAt?: number;
  readonly first: CreateOnlineMatchPlayerParams;
  readonly second: CreateOnlineMatchPlayerParams;
}

export interface OnlineMatchDeckSnapshot {
  readonly seat: Seat;
  readonly userId: string;
  readonly sourceDeckId: string | null;
  readonly sourceDeckName: string | null;
  readonly mainDeck: readonly AnyCardData[];
  readonly energyDeck: readonly AnyCardData[];
  readonly lockedAt: number | null;
}

export interface OnlineMatchState {
  readonly matchId: string;
  readonly roomCode: string;
  readonly session: GameSession;
  readonly participants: Readonly<Record<Seat, OnlineMatchParticipant>>;
  readonly deckSnapshots: Readonly<Record<Seat, OnlineMatchDeckSnapshot>>;
  readonly startedAt: number;
  updatedAt: number;
  lastActivityAt: number;
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

  constructor(deps: OnlineMatchServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.idGenerator = deps.idGenerator ?? randomUUID;
    this.recorder = deps.recorder === undefined ? matchRecorderService : deps.recorder;
  }

  async createMatch(params: CreateOnlineMatchParams): Promise<OnlineMatchState> {
    const matchId = this.idGenerator();
    const session = createGameSession();
    const firstPlayerId = `${matchId}:FIRST:${params.first.userId}`;
    const secondPlayerId = `${matchId}:SECOND:${params.second.userId}`;
    const now = params.startedAt ?? this.now();
    const state: OnlineMatchState = {
      matchId,
      roomCode: params.roomCode,
      session,
      participants: {
        FIRST: {
          userId: params.first.userId,
          playerId: firstPlayerId,
          displayName: params.first.displayName,
          seat: 'FIRST',
        },
        SECOND: {
          userId: params.second.userId,
          playerId: secondPlayerId,
          displayName: params.second.displayName,
          seat: 'SECOND',
        },
      },
      deckSnapshots: {
        FIRST: createRuntimeDeckSnapshot('FIRST', params.first),
        SECOND: createRuntimeDeckSnapshot('SECOND', params.second),
      },
      startedAt: now,
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
      seq: match.session.getCurrentPublicEventSeq(),
      turnCount: firstPlayerView.match.turnCount,
      phase: firstPlayerView.match.phase,
      subPhase: firstPlayerView.match.subPhase,
      activeSeat: firstPlayerView.match.activeSeat,
    };
  }

  getMatchSnapshot(matchId: string, userId: string): OnlineMatchSnapshot | null;
  getMatchSnapshot(
    matchId: string,
    userId: string,
    options: { readonly sinceSeq?: number }
  ): OnlineMatchSnapshotResponse | null;
  getMatchSnapshot(
    matchId: string,
    userId: string,
    options: { readonly sinceSeq?: number } = {}
  ): OnlineMatchSnapshotResponse | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    touchMatch(match);
    const currentSeq = match.session.getCurrentPublicEventSeq();
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
      await this.appendSessionRecordFrame(match, 'COMMAND_REJECTED', {
        summary: '服务层拒绝阶段推进：当前不是该玩家的推进时机',
        force: true,
        writeAuthorityCheckpoint: false,
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

    await this.sealCompletedMatchIfNeeded(match);

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
    frameType: 'COMMAND_ACCEPTED' | 'COMMAND_REJECTED' | 'SYSTEM_TRANSITION',
    options: {
      readonly summary?: string;
      readonly force?: boolean;
      readonly writeAuthorityCheckpoint?: boolean;
      readonly decisionRecords?: readonly MatchDecisionRecordInput[];
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

      const firstPrivateEvents = match.session.getPrivateEventsSince(
        match.participants.FIRST.playerId,
        cursor.lastPrivateSeqBySeat.FIRST
      );
      const secondPrivateEvents = match.session.getPrivateEventsSince(
        match.participants.SECOND.playerId,
        cursor.lastPrivateSeqBySeat.SECOND
      );
      const publicEvents = match.session.getPublicEventsSince(cursor.lastPublicSeq);
      const sealedAudit = match.session.getSealedAuditSince(cursor.lastAuditSeq);
      const commandLog = match.session.getCommandLogSince(cursor.lastCommandSeq);
      const gameEvents = match.session.getGameEventsSince(cursor.lastGameEventSeq);
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
            cursor.lastPrivateSeqBySeat.FIRST,
          SECOND:
            latestSeq(secondPrivateEvents, (event) => event.seq) ??
            cursor.lastPrivateSeqBySeat.SECOND,
        },
        publicEvents,
        privateEventsBySeat: {
          FIRST: firstPrivateEvents,
          SECOND: secondPrivateEvents,
        },
        decisionRecords: options.decisionRecords,
        createdAt: this.now(),
      });
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
  const playerViewState = match.session.getPlayerViewState(participant.playerId);
  if (!playerViewState) {
    throw new Error('联机玩家视图不存在');
  }

  return {
    matchId: match.matchId,
    seat: participant.seat,
    playerId: participant.playerId,
    seq: match.session.getCurrentPublicEventSeq(),
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
    mainDeck: deck.mainDeck,
    energyDeck: deck.energyDeck,
    lockedAt: params.lockedAt ?? null,
  };
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
