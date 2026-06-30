import { createHash } from 'node:crypto';
import type { AnyCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import type {
  MatchAutomationGameMode,
  MatchDeckSnapshotSource,
  MatchDeckSnapshotValidationState,
  MatchDecisionCardSummary,
  MatchDecisionRecordStatus,
  MatchDecisionSubmissionSummary,
  MatchDecisionTransitionSemantics,
  MatchDecisionType,
  MatchDecisionVisibleContextSummary,
  MatchMode,
  MatchOriginKind,
  MatchParticipantKind,
  MatchRecordCompleteness,
  MatchRecordStatus,
  ReplayCapability,
  ReplayLimitation,
  ReplayRecordFrameType,
  ReplayVisibilityScope,
} from '../../online/replay-types.js';
import type { PrivateEvent, PublicEvent, Seat } from '../../online/types.js';
import type { OnlineMatchState } from './online-match-service.js';
import {
  GAME_STATE_SCHEMA_VERSION,
  REPLAY_CARD_DATA_VERSION,
  REPLAY_RECORD_SCHEMA_VERSION,
  REPLAY_RULES_VERSION,
} from './replay-constants.js';
import {
  serializeReplayPayload,
  stableJsonStringify,
  toReplayJsonValue,
} from './replay-payload-serialization.js';

const RECORDER_SEATS: readonly Seat[] = ['FIRST', 'SECOND'];
const DEFAULT_REPLAY_CAPABILITIES: readonly ReplayCapability[] = [
  'AUTHORITY_CHECKPOINT',
  'PUBLIC_EVENTS',
  'PRIVATE_EVENTS',
  'DECISION_RECORDS_PARTIAL',
];
const DEFAULT_REPLAY_LIMITATIONS: readonly ReplayLimitation[] = [];

export interface MatchRecorderQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface MatchRecorderQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<MatchRecorderQueryResult<T>>;
}

export interface MatchRecorderParticipantInput {
  readonly seat: Seat;
  readonly userId: string;
  readonly displayName: string;
  readonly playerId: string;
  readonly participantKind?: MatchParticipantKind;
  readonly ownerUserId?: string | null;
}

export interface MatchRecorderCardSummary {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: string;
  readonly groupNames?: readonly string[];
  readonly unitName?: string;
  readonly cost?: number;
  readonly score?: number;
  readonly imageFilename?: string;
  readonly rare?: string;
  readonly product?: string;
  readonly cardText?: string;
}

export interface MatchRecorderDeckSnapshotInput {
  readonly seat: Seat;
  readonly userId: string;
  readonly sourceDeckId: string | null;
  readonly sourceDeckName: string | null;
  readonly source: MatchDeckSnapshotSource;
  readonly mainDeck: readonly string[];
  readonly energyDeck: readonly string[];
  readonly cardSummaries: Readonly<Record<string, MatchRecorderCardSummary>>;
  readonly validationState: MatchDeckSnapshotValidationState;
  readonly cardDataVersion: string;
  readonly cardDataHash: string;
  readonly lockedAt: number | null;
}

export interface BeginMatchRecordInput {
  readonly matchId: string;
  readonly roomCode: string;
  readonly matchMode?: MatchMode;
  readonly automationGameMode?: MatchAutomationGameMode;
  readonly originKind?: MatchOriginKind;
  readonly originLabel?: string;
  readonly startedAt: number;
  readonly participants: Readonly<Record<Seat, MatchRecorderParticipantInput>>;
  readonly deckSnapshots: Readonly<Record<Seat, MatchRecorderDeckSnapshotInput>>;
  readonly rulesVersion?: string;
  readonly cardDataVersion?: string;
  readonly cardDataHash?: string;
  readonly replayCapabilities?: readonly ReplayCapability[];
  readonly replayLimitations?: readonly ReplayLimitation[];
}

export interface RecordInitialCheckpointInput {
  readonly matchId: string;
  readonly authorityState: GameState;
  readonly relatedPublicSeq?: number | null;
  readonly relatedCommandSeq?: number | null;
  readonly relatedGameEventSeq?: number | null;
  readonly createdAt?: number;
}

export interface MatchDecisionRecordInput {
  readonly decisionId: string;
  readonly decisionSchemaVersion?: number;
  readonly decisionType: MatchDecisionType;
  readonly status: MatchDecisionRecordStatus;
  readonly playerId?: string | null;
  readonly eventIds?: readonly string[];
  readonly sourceType?: string | null;
  readonly sourceCardObjectId?: string | null;
  readonly sourceCardCode?: string | null;
  readonly sourceBaseCardCode?: string | null;
  readonly sourceZone?: string | null;
  readonly sourceSlot?: string | null;
  readonly abilityId?: string | null;
  readonly triggerCondition?: string | null;
  readonly abilityCategory?: string | null;
  readonly abilitySourceZone?: string | null;
  readonly effectTextSnapshot?: string | null;
  readonly stepId?: string | null;
  readonly stepText?: string | null;
  readonly waitingSeat?: Seat | null;
  readonly visibleCandidates?: readonly MatchDecisionCardSummary[];
  readonly auditCandidates?: readonly MatchDecisionCardSummary[];
  readonly visibleContextSummary?: MatchDecisionVisibleContextSummary | null;
  readonly minSelect?: number | null;
  readonly maxSelect?: number | null;
  readonly canSkip?: boolean | null;
  readonly openedCheckpointSeq?: number | null;
  readonly submittedTimelineSeq?: number | null;
  readonly submittedCommandSeq?: number | null;
  readonly submission?: MatchDecisionSubmissionSummary | null;
  readonly resultSummary?: string | null;
  readonly replayCapability?: ReplayCapability;
  readonly transitionSemantics: MatchDecisionTransitionSemantics;
}

export interface AppendMatchRecordFrameInput {
  readonly matchId: string;
  readonly frameType: Extract<
    ReplayRecordFrameType,
    | 'COMMAND_ACCEPTED'
    | 'COMMAND_REJECTED'
    | 'SYSTEM_TRANSITION'
    | 'UNDO_REQUESTED'
    | 'UNDO_ACCEPTED'
    | 'UNDO_REJECTED'
    | 'UNDO_EXPIRED'
    | 'UNDO_APPLIED'
  >;
  readonly visibilityScope?: ReplayVisibilityScope;
  readonly summary?: string;
  readonly authorityState?: GameState | null;
  readonly stateSummary?: {
    readonly turnCount: number;
    readonly phase: string;
    readonly subPhase: string;
  } | null;
  readonly writeAuthorityCheckpoint?: boolean;
  readonly relatedPublicSeq?: number | null;
  readonly relatedPrivateSeq?: number | null;
  readonly relatedAuditSeq?: number | null;
  readonly relatedCommandSeq?: number | null;
  readonly relatedGameEventSeq?: number | null;
  readonly latestPrivateSeqBySeat?: Partial<Record<Seat, number>>;
  readonly publicEvents?: readonly PublicEvent[];
  readonly privateEventsBySeat?: Partial<Record<Seat, readonly PrivateEvent[]>>;
  readonly decisionRecords?: readonly MatchDecisionRecordInput[];
  readonly dedupeKey?: string;
  readonly createdAt?: number;
}

export interface SealMatchRecordInput {
  readonly matchId: string;
  readonly status: Exclude<MatchRecordStatus, 'IN_PROGRESS'>;
  readonly completeness?: MatchRecordCompleteness;
  readonly endedAt?: number;
  readonly sealedAt?: number;
  readonly winnerSeat?: Seat | null;
  readonly endReason?: string | null;
  readonly turnCount?: number;
  readonly phase?: string;
  readonly subPhase?: string;
}

export interface MarkMatchRecordPartialInput {
  readonly matchId: string;
  readonly status?: MatchRecordStatus;
  readonly completeness?: Extract<MatchRecordCompleteness, 'PARTIAL' | 'INCOMPLETE'>;
  readonly partialReason?: string | null;
  readonly recorderError?: string | null;
  readonly appendFailureAt?: number | null;
}

export interface MatchRecordCursor {
  readonly matchId: string;
  readonly status: MatchRecordStatus;
  readonly completeness: MatchRecordCompleteness;
  readonly turnCount: number;
  readonly lastTimelineSeq: number;
  readonly lastCheckpointSeq: number;
  readonly lastPublicSeq: number;
  readonly lastPrivateSeqBySeat: Readonly<Record<Seat, number>>;
  readonly lastAuditSeq: number;
  readonly lastCommandSeq: number;
  readonly lastGameEventSeq: number;
}

export interface BeginMatchRecordResult extends MatchRecordCursor {
  readonly recordSchemaVersion: number;
}

export interface RecordCheckpointResult {
  readonly matchId: string;
  readonly timelineSeq: number;
  readonly checkpointSeq: number;
  readonly payloadHash: string;
}

export interface AppendMatchRecordFrameResult {
  readonly matchId: string;
  readonly timelineSeq: number;
  readonly checkpointSeq: number | null;
  readonly payloadHash: string | null;
}

export interface SealMatchRecordResult {
  readonly matchId: string;
  readonly timelineSeq: number;
  readonly status: Exclude<MatchRecordStatus, 'IN_PROGRESS'>;
  readonly completeness: MatchRecordCompleteness;
}

interface MatchRecorderDeps {
  readonly now?: () => number;
  readonly queryClient?: MatchRecorderQueryClient;
  readonly transaction?: <T>(
    callback: (client: MatchRecorderQueryClient) => Promise<T>
  ) => Promise<T>;
}

interface IdRow {
  readonly id: string;
}

interface CursorRow {
  readonly match_id: string;
  readonly status: MatchRecordStatus;
  readonly completeness: MatchRecordCompleteness;
  readonly turn_count: number;
  readonly last_timeline_seq: number;
  readonly last_checkpoint_seq: number;
  readonly last_public_seq: number;
  readonly last_private_seq_by_seat: unknown;
  readonly last_audit_seq: number;
  readonly last_command_seq: number;
  readonly last_game_event_seq: number;
}

interface ExistingTimelineFrameRow {
  readonly timeline_seq: number;
  readonly related_checkpoint_seq: number | null;
  readonly payload_hash: string | null;
}

interface ExistingTimelineFrame {
  readonly timelineSeq: number;
  readonly checkpointSeq: number | null;
  readonly payloadHash: string | null;
}

export class MatchRecorderServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MatchRecorderServiceError';
    this.code = code;
  }
}

export class MatchRecorderService {
  private readonly now: () => number;
  private readonly queryClient: MatchRecorderQueryClient;
  private readonly transaction: <T>(
    callback: (client: MatchRecorderQueryClient) => Promise<T>
  ) => Promise<T>;

  constructor(deps: MatchRecorderDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.queryClient = deps.queryClient ?? createDefaultQueryClient();
    this.transaction = deps.transaction ?? withPoolTransaction;
  }

  async beginMatch(input: BeginMatchRecordInput): Promise<BeginMatchRecordResult> {
    return this.transaction(async (client) => {
      const rulesVersion = input.rulesVersion ?? REPLAY_RULES_VERSION;
      const cardDataVersion = input.cardDataVersion ?? REPLAY_CARD_DATA_VERSION;
      const cardDataHash = input.cardDataHash ?? assertSharedCardDataHash(input.deckSnapshots);
      const replayCapabilities = input.replayCapabilities ?? DEFAULT_REPLAY_CAPABILITIES;
      const replayLimitations = input.replayLimitations ?? DEFAULT_REPLAY_LIMITATIONS;

      await client.query(
        `INSERT INTO match_records (
          match_id,
          room_code,
          match_mode,
          automation_game_mode,
          origin_kind,
          origin_label,
          status,
          completeness,
          started_at,
          first_user_id,
          second_user_id,
          record_version,
          rules_version,
          card_data_version,
          card_data_hash,
          replay_capabilities,
          replay_limitations
        ) VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS', 'FULL', $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          input.matchId,
          input.roomCode,
          input.matchMode ?? 'ONLINE',
          input.automationGameMode ?? 'DEBUG',
          input.originKind ?? 'ONLINE_ROOM',
          input.originLabel ?? input.roomCode,
          toDate(input.startedAt),
          input.participants.FIRST.userId,
          input.participants.SECOND.userId,
          REPLAY_RECORD_SCHEMA_VERSION,
          rulesVersion,
          cardDataVersion,
          cardDataHash,
          toJsonbParam(replayCapabilities),
          toJsonbParam(replayLimitations),
        ]
      );

      const deckSnapshotIds: Partial<Record<Seat, string>> = {};
      for (const seat of RECORDER_SEATS) {
        const snapshot = input.deckSnapshots[seat];
        const inserted = await client.query<IdRow>(
          `INSERT INTO match_deck_snapshots (
            match_id,
            seat,
            user_id,
            source_deck_id,
            source_deck_name,
            source,
            main_deck,
            energy_deck,
            card_summaries,
            validation_state,
            card_data_version,
            card_data_hash,
            locked_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
          [
            input.matchId,
            seat,
            snapshot.userId,
            snapshot.sourceDeckId,
            snapshot.sourceDeckName,
            snapshot.source,
            toJsonbParam([...snapshot.mainDeck]),
            toJsonbParam([...snapshot.energyDeck]),
            toJsonbParam(snapshot.cardSummaries),
            snapshot.validationState,
            snapshot.cardDataVersion,
            snapshot.cardDataHash,
            toNullableDate(snapshot.lockedAt),
          ]
        );
        const deckSnapshotId = inserted.rows[0]?.id;
        if (!deckSnapshotId) {
          throw new MatchRecorderServiceError(
            'MATCH_RECORDER_DECK_SNAPSHOT_INSERT_FAILED',
            '写入历史卡组快照失败'
          );
        }
        deckSnapshotIds[seat] = deckSnapshotId;
      }

      for (const seat of RECORDER_SEATS) {
        const participant = input.participants[seat];
        await client.query(
          `INSERT INTO match_participants (
            match_id,
            user_id,
            seat,
            display_name,
            player_id,
            participant_kind,
            owner_user_id,
            deck_snapshot_id,
            replay_access
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PARTICIPANT')`,
          [
            input.matchId,
            participant.userId,
            seat,
            participant.displayName,
            participant.playerId,
            participant.participantKind ?? 'USER',
            participant.ownerUserId ?? null,
            deckSnapshotIds[seat] ?? null,
          ]
        );
      }

      return {
        matchId: input.matchId,
        status: 'IN_PROGRESS',
        completeness: 'FULL',
        turnCount: 0,
        lastTimelineSeq: 0,
        lastCheckpointSeq: 0,
        lastPublicSeq: 0,
        lastPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
        lastAuditSeq: 0,
        lastCommandSeq: 0,
        lastGameEventSeq: 0,
        recordSchemaVersion: REPLAY_RECORD_SCHEMA_VERSION,
      };
    });
  }

  async recordInitialCheckpoint(
    input: RecordInitialCheckpointInput
  ): Promise<RecordCheckpointResult> {
    return this.transaction(async (client) => {
      const cursor = await lockRecordCursor(client, input.matchId);
      const timelineSeq = cursor.lastTimelineSeq + 1;
      const checkpointSeq = cursor.lastCheckpointSeq + 1;
      const createdAt = input.createdAt ?? this.now();
      const relatedPublicSeq = nullableSeq(input.relatedPublicSeq);
      const relatedCommandSeq = nullableSeq(input.relatedCommandSeq);
      const relatedGameEventSeq = nullableSeq(input.relatedGameEventSeq);

      await insertTimelineFrame(client, {
        matchId: input.matchId,
        timelineSeq,
        frameType: 'MATCH_INITIALIZED',
        visibilityScope: 'ADMIN',
        relatedCheckpointSeq: checkpointSeq,
        relatedPublicSeq,
        relatedPrivateSeq: null,
        relatedPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
        relatedAuditSeq: null,
        relatedCommandSeq,
        relatedGameEventSeq,
        relatedDecisionId: null,
        dedupeKey: 'match-initialized',
        turnCount: input.authorityState.turnCount,
        phase: String(input.authorityState.currentPhase),
        subPhase: String(input.authorityState.currentSubPhase),
        summary: '初始化权威检查点',
        createdAt,
      });

      const payloadHash = await insertAuthorityCheckpoint(client, {
        matchId: input.matchId,
        checkpointSeq,
        timelineSeq,
        authorityState: input.authorityState,
        relatedPublicSeq,
        relatedCommandSeq,
        relatedGameEventSeq,
        createdAt,
      });

      await client.query(
        `UPDATE match_records
        SET
          last_timeline_seq = $2,
          last_checkpoint_seq = $3,
          last_public_seq = GREATEST(last_public_seq, $4),
          last_command_seq = GREATEST(last_command_seq, $5),
          last_game_event_seq = GREATEST(last_game_event_seq, $6),
          turn_count = $7,
          updated_at = now()
        WHERE match_id = $1`,
        [
          input.matchId,
          timelineSeq,
          checkpointSeq,
          relatedPublicSeq ?? 0,
          relatedCommandSeq ?? 0,
          relatedGameEventSeq ?? 0,
          input.authorityState.turnCount,
        ]
      );

      return {
        matchId: input.matchId,
        timelineSeq,
        checkpointSeq,
        payloadHash,
      };
    });
  }

  async appendMatchRecordFrame(
    input: AppendMatchRecordFrameInput
  ): Promise<AppendMatchRecordFrameResult> {
    return this.transaction(async (client) => {
      const cursor = await lockRecordCursor(client, input.matchId);
      const timelineSeq = cursor.lastTimelineSeq + 1;
      const createdAt = input.createdAt ?? this.now();
      const relatedPublicSeq = nullableSeq(input.relatedPublicSeq);
      const relatedPrivateSeq = nullableSeq(input.relatedPrivateSeq);
      const relatedAuditSeq = nullableSeq(input.relatedAuditSeq);
      const relatedCommandSeq = nullableSeq(input.relatedCommandSeq);
      const relatedGameEventSeq = nullableSeq(input.relatedGameEventSeq);
      const decisionRecords = input.decisionRecords ?? [];
      const latestPrivateSeqBySeat = mergePrivateSeqBySeat(
        cursor.lastPrivateSeqBySeat,
        input.latestPrivateSeqBySeat
      );
      const dedupeKey =
        input.dedupeKey ??
        buildTransitionDedupeKey(input.frameType, {
          timelineSeq,
          relatedPublicSeq,
          relatedCommandSeq,
          relatedGameEventSeq,
        });
      const existingFrame = await findTimelineFrameByDedupeKey(client, input.matchId, dedupeKey);
      if (existingFrame) {
        return {
          matchId: input.matchId,
          timelineSeq: existingFrame.timelineSeq,
          checkpointSeq: existingFrame.checkpointSeq,
          payloadHash: existingFrame.payloadHash,
        };
      }
      const shouldWriteCheckpoint =
        !!input.authorityState &&
        input.frameType !== 'COMMAND_REJECTED' &&
        input.writeAuthorityCheckpoint !== false;
      const checkpointSeq = shouldWriteCheckpoint ? cursor.lastCheckpointSeq + 1 : null;
      const recordTurnCount = input.authorityState?.turnCount ?? input.stateSummary?.turnCount ?? null;
      const timelineTurnCount = recordTurnCount ?? cursor.turnCount;
      const phase = input.authorityState
        ? String(input.authorityState.currentPhase)
        : (input.stateSummary?.phase ?? 'UNKNOWN');
      const subPhase = input.authorityState
        ? String(input.authorityState.currentSubPhase)
        : (input.stateSummary?.subPhase ?? 'UNKNOWN');

      await insertTimelineFrame(client, {
        matchId: input.matchId,
        timelineSeq,
        frameType: input.frameType,
        visibilityScope: input.visibilityScope ?? defaultVisibilityForFrame(input.frameType),
        relatedCheckpointSeq: checkpointSeq,
        relatedPublicSeq,
        relatedPrivateSeq,
        relatedPrivateSeqBySeat: latestPrivateSeqBySeat,
        relatedAuditSeq,
        relatedCommandSeq,
        relatedGameEventSeq,
        relatedDecisionId: decisionRecords.length === 1 ? decisionRecords[0].decisionId : null,
        dedupeKey,
        turnCount: timelineTurnCount,
        phase,
        subPhase,
        summary: input.summary ?? defaultSummaryForFrame(input.frameType),
        createdAt,
      });

      await insertPublicEventRows(client, {
        matchId: input.matchId,
        timelineSeq,
        events: input.publicEvents ?? [],
      });
      await insertPrivateEventRows(client, {
        matchId: input.matchId,
        timelineSeq,
        eventsBySeat: input.privateEventsBySeat ?? {},
      });
      await insertDecisionRecordRows(client, {
        matchId: input.matchId,
        timelineSeq,
        defaultCheckpointSeq: checkpointSeq,
        defaultCommandSeq: relatedCommandSeq,
        records: decisionRecords,
        createdAt,
      });

      const payloadHash =
        checkpointSeq && input.authorityState
          ? await insertAuthorityCheckpoint(client, {
              matchId: input.matchId,
              checkpointSeq,
              timelineSeq,
              authorityState: input.authorityState,
              relatedPublicSeq,
              relatedCommandSeq,
              relatedGameEventSeq,
              createdAt,
            })
          : null;

      await client.query(
        `UPDATE match_records
        SET
          last_timeline_seq = $2,
          last_checkpoint_seq = GREATEST(last_checkpoint_seq, $3),
          last_public_seq = GREATEST(last_public_seq, $4),
          last_private_seq_by_seat = jsonb_build_object(
            'FIRST', GREATEST(COALESCE((last_private_seq_by_seat->>'FIRST')::int, 0), $5),
            'SECOND', GREATEST(COALESCE((last_private_seq_by_seat->>'SECOND')::int, 0), $6)
          ),
          last_audit_seq = GREATEST(last_audit_seq, $7),
          last_command_seq = GREATEST(last_command_seq, $8),
          last_game_event_seq = GREATEST(last_game_event_seq, $9),
          turn_count = GREATEST(turn_count, COALESCE($10, turn_count)),
          updated_at = now()
        WHERE match_id = $1`,
        [
          input.matchId,
          timelineSeq,
          checkpointSeq ?? cursor.lastCheckpointSeq,
          relatedPublicSeq ?? cursor.lastPublicSeq,
          latestPrivateSeqBySeat.FIRST,
          latestPrivateSeqBySeat.SECOND,
          relatedAuditSeq ?? cursor.lastAuditSeq,
          relatedCommandSeq ?? cursor.lastCommandSeq,
          relatedGameEventSeq ?? cursor.lastGameEventSeq,
          recordTurnCount,
        ]
      );

      return {
        matchId: input.matchId,
        timelineSeq,
        checkpointSeq,
        payloadHash,
      };
    });
  }

  async sealMatch(input: SealMatchRecordInput): Promise<SealMatchRecordResult> {
    return this.transaction(async (client) => {
      const cursor = await lockRecordCursor(client, input.matchId);
      const timelineSeq = cursor.lastTimelineSeq + 1;
      const sealedAt = input.sealedAt ?? this.now();
      const endedAt = input.endedAt ?? sealedAt;
      const completeness =
        input.completeness ?? (input.status === 'COMPLETED' ? 'FULL' : 'PARTIAL');

      await insertTimelineFrame(client, {
        matchId: input.matchId,
        timelineSeq,
        frameType: 'MATCH_SEALED',
        visibilityScope: 'SYSTEM',
        relatedCheckpointSeq: null,
        relatedPublicSeq: null,
        relatedPrivateSeq: null,
        relatedPrivateSeqBySeat: cursor.lastPrivateSeqBySeat,
        relatedAuditSeq: null,
        relatedCommandSeq: null,
        relatedGameEventSeq: null,
        relatedDecisionId: null,
        dedupeKey: `match-sealed:${input.status}`,
        turnCount: input.turnCount ?? cursor.turnCount,
        phase: input.phase ?? 'UNKNOWN',
        subPhase: input.subPhase ?? 'UNKNOWN',
        summary: `封存对局：${input.status}`,
        createdAt: sealedAt,
      });

      await client.query(
        `UPDATE match_records
        SET
          status = $2,
          completeness = $3,
          ended_at = $4,
          sealed_at = $5,
          winner_seat = $6,
          end_reason = $7,
          turn_count = GREATEST(turn_count, $8),
          last_timeline_seq = $9,
          updated_at = now()
        WHERE match_id = $1`,
        [
          input.matchId,
          input.status,
          completeness,
          toDate(endedAt),
          toDate(sealedAt),
          input.winnerSeat ?? null,
          input.endReason ?? null,
          input.turnCount ?? cursor.turnCount,
          timelineSeq,
        ]
      );

      return {
        matchId: input.matchId,
        timelineSeq,
        status: input.status,
        completeness,
      };
    });
  }

  async markPartial(input: MarkMatchRecordPartialInput): Promise<void> {
    await this.queryClient.query(
      `UPDATE match_records
      SET
        status = COALESCE($2, status),
        completeness = $3,
        partial_reason = $4,
        last_recorder_error = $5,
        append_failure_at = $6,
        updated_at = now()
      WHERE match_id = $1`,
      [
        input.matchId,
        input.status ?? null,
        input.completeness ?? 'PARTIAL',
        input.partialReason ?? null,
        input.recorderError ?? null,
        toNullableDate(input.appendFailureAt ?? this.now()),
      ]
    );
  }

  async getRecordCursor(matchId: string): Promise<MatchRecordCursor | null> {
    const result = await this.queryClient.query<CursorRow>(
      `SELECT
        match_id,
        status,
        completeness,
        turn_count,
        last_timeline_seq,
        last_checkpoint_seq,
        last_public_seq,
        last_private_seq_by_seat,
        last_audit_seq,
        last_command_seq,
        last_game_event_seq
      FROM match_records
      WHERE match_id = $1`,
      [matchId]
    );
    const row = result.rows[0];
    return row ? mapCursorRow(row) : null;
  }
}

export const matchRecorderService = new MatchRecorderService();

export function buildMatchRecorderBeginInputFromOnlineMatch(
  match: OnlineMatchState
): BeginMatchRecordInput {
  const cardDataHash = hashJsonValue(buildRuntimeCardDataHashInput(match));

  return {
    matchId: match.matchId,
    roomCode: match.roomCode,
    matchMode: match.matchMode,
    automationGameMode: match.automationGameMode,
    originKind: match.originKind,
    originLabel: match.originLabel,
    startedAt: match.startedAt,
    participants: {
      FIRST: {
        seat: 'FIRST',
        userId: match.participants.FIRST.userId,
        displayName: match.participants.FIRST.displayName,
        playerId: match.participants.FIRST.playerId,
        participantKind: match.participants.FIRST.participantKind,
        ownerUserId: match.participants.FIRST.ownerUserId,
      },
      SECOND: {
        seat: 'SECOND',
        userId: match.participants.SECOND.userId,
        displayName: match.participants.SECOND.displayName,
        playerId: match.participants.SECOND.playerId,
        participantKind: match.participants.SECOND.participantKind,
        ownerUserId: match.participants.SECOND.ownerUserId,
      },
    },
    deckSnapshots: {
      FIRST: buildDeckSnapshotInput(match, 'FIRST', cardDataHash),
      SECOND: buildDeckSnapshotInput(match, 'SECOND', cardDataHash),
    },
    rulesVersion: REPLAY_RULES_VERSION,
    cardDataVersion: REPLAY_CARD_DATA_VERSION,
    cardDataHash,
    replayCapabilities: DEFAULT_REPLAY_CAPABILITIES,
    replayLimitations:
      match.matchMode === 'SOLITAIRE'
        ? ['SOLITAIRE_AUTOMATION_COMPRESSED']
        : DEFAULT_REPLAY_LIMITATIONS,
  };
}

async function withPoolTransaction<T>(
  callback: (client: MatchRecorderQueryClient) => Promise<T>
): Promise<T> {
  const { pool } = await import('../db/pool.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createDefaultQueryClient(): MatchRecorderQueryClient {
  return {
    async query<T = unknown>(
      text: string,
      values?: readonly unknown[]
    ): Promise<MatchRecorderQueryResult<T>> {
      const { pool } = await import('../db/pool.js');
      const result = await pool.query(text, values ? [...values] : undefined);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount,
      };
    },
  };
}

async function lockRecordCursor(
  client: MatchRecorderQueryClient,
  matchId: string
): Promise<MatchRecordCursor> {
  const result = await client.query<CursorRow>(
    `SELECT
      match_id,
      status,
      completeness,
      turn_count,
      last_timeline_seq,
      last_checkpoint_seq,
      last_public_seq,
      last_private_seq_by_seat,
      last_audit_seq,
      last_command_seq,
      last_game_event_seq
    FROM match_records
    WHERE match_id = $1
    FOR UPDATE`,
    [matchId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new MatchRecorderServiceError('MATCH_RECORDER_RECORD_NOT_FOUND', '历史对局记录不存在');
  }
  return mapCursorRow(row);
}

function mapCursorRow(row: CursorRow): MatchRecordCursor {
  return {
    matchId: row.match_id,
    status: row.status,
    completeness: row.completeness,
    turnCount: row.turn_count,
    lastTimelineSeq: row.last_timeline_seq,
    lastCheckpointSeq: row.last_checkpoint_seq,
    lastPublicSeq: row.last_public_seq,
    lastPrivateSeqBySeat: mapPrivateSeqBySeat(row.last_private_seq_by_seat),
    lastAuditSeq: row.last_audit_seq,
    lastCommandSeq: row.last_command_seq,
    lastGameEventSeq: row.last_game_event_seq,
  };
}

async function findTimelineFrameByDedupeKey(
  client: MatchRecorderQueryClient,
  matchId: string,
  dedupeKey: string
): Promise<ExistingTimelineFrame | null> {
  const result = await client.query<ExistingTimelineFrameRow>(
    `SELECT
      frame.timeline_seq,
      frame.related_checkpoint_seq,
      checkpoint.payload_hash
    FROM match_timeline_entries frame
    LEFT JOIN match_checkpoints checkpoint
      ON checkpoint.match_id = frame.match_id
      AND checkpoint.timeline_seq = frame.timeline_seq
    WHERE frame.match_id = $1
      AND frame.dedupe_key = $2
    LIMIT 1`,
    [matchId, dedupeKey]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    timelineSeq: row.timeline_seq,
    checkpointSeq: row.related_checkpoint_seq,
    payloadHash: row.payload_hash,
  };
}

async function insertTimelineFrame(
  client: MatchRecorderQueryClient,
  frame: {
    readonly matchId: string;
    readonly timelineSeq: number;
    readonly frameType: ReplayRecordFrameType;
    readonly visibilityScope: ReplayVisibilityScope;
    readonly relatedCheckpointSeq: number | null;
    readonly relatedPublicSeq: number | null;
    readonly relatedPrivateSeq: number | null;
    readonly relatedPrivateSeqBySeat: Readonly<Record<Seat, number>>;
    readonly relatedAuditSeq: number | null;
    readonly relatedCommandSeq: number | null;
    readonly relatedGameEventSeq: number | null;
    readonly relatedDecisionId: string | null;
    readonly dedupeKey: string;
    readonly turnCount: number;
    readonly phase: string;
    readonly subPhase: string;
    readonly summary: string;
    readonly createdAt: number;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO match_timeline_entries (
      match_id,
      timeline_seq,
      frame_type,
      visibility_scope,
      related_checkpoint_seq,
      related_public_seq,
      related_private_seq,
      related_private_seq_by_seat,
      related_audit_seq,
      related_command_seq,
      related_game_event_seq,
      related_decision_id,
      dedupe_key,
      turn_count,
      phase,
      sub_phase,
      summary,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      frame.matchId,
      frame.timelineSeq,
      frame.frameType,
      frame.visibilityScope,
      frame.relatedCheckpointSeq,
      frame.relatedPublicSeq,
      frame.relatedPrivateSeq,
      toJsonbParam(frame.relatedPrivateSeqBySeat),
      frame.relatedAuditSeq,
      frame.relatedCommandSeq,
      frame.relatedGameEventSeq,
      frame.relatedDecisionId,
      frame.dedupeKey,
      frame.turnCount,
      frame.phase,
      frame.subPhase,
      frame.summary,
      toDate(frame.createdAt),
    ]
  );
}

async function insertPublicEventRows(
  client: MatchRecorderQueryClient,
  input: {
    readonly matchId: string;
    readonly timelineSeq: number;
    readonly events: readonly PublicEvent[];
  }
): Promise<void> {
  for (const event of input.events) {
    await client.query(
      `INSERT INTO match_record_public_events (
        match_id,
        timeline_seq,
        event_seq,
        event_id,
        event_type,
        source,
        actor_seat,
        summary,
        payload,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (match_id, timeline_seq, event_seq) DO NOTHING`,
      [
        input.matchId,
        input.timelineSeq,
        event.seq,
        event.eventId,
        event.type,
        'source' in event ? event.source : null,
        event.actorSeat ?? null,
        summarizePublicEvent(event),
        toJsonbParam(event),
        toDate(event.timestamp),
      ]
    );
  }
}

async function insertPrivateEventRows(
  client: MatchRecorderQueryClient,
  input: {
    readonly matchId: string;
    readonly timelineSeq: number;
    readonly eventsBySeat: Partial<Record<Seat, readonly PrivateEvent[]>>;
  }
): Promise<void> {
  for (const seat of RECORDER_SEATS) {
    for (const event of input.eventsBySeat[seat] ?? []) {
      await client.query(
        `INSERT INTO match_record_private_events (
          match_id,
          seat,
          timeline_seq,
          event_seq,
          event_id,
          event_type,
          related_public_seq,
          summary,
          payload,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (match_id, seat, timeline_seq, event_seq) DO NOTHING`,
        [
          input.matchId,
          seat,
          input.timelineSeq,
          event.seq,
          event.eventId,
          event.type,
          event.relatedPublicSeq,
          summarizePrivateEvent(event),
          toJsonbParam(event),
          toDate(event.timestamp),
        ]
      );
    }
  }
}

async function insertDecisionRecordRows(
  client: MatchRecorderQueryClient,
  input: {
    readonly matchId: string;
    readonly timelineSeq: number;
    readonly defaultCheckpointSeq: number | null;
    readonly defaultCommandSeq: number | null;
    readonly records: readonly MatchDecisionRecordInput[];
    readonly createdAt: number;
  }
): Promise<void> {
  for (const record of input.records) {
    await client.query(
      `INSERT INTO match_decision_records (
        match_id,
        decision_id,
        timeline_seq,
        decision_schema_version,
        decision_type,
        status,
        player_id,
        event_ids,
        source_type,
        source_card_object_id,
        source_card_code,
        source_base_card_code,
        source_zone,
        source_slot,
        ability_id,
        trigger_condition,
        ability_category,
        ability_source_zone,
        effect_text_snapshot,
        step_id,
        step_text,
        waiting_seat,
        visible_candidates,
        audit_candidates,
        visible_context_summary,
        min_select,
        max_select,
        can_skip,
        opened_checkpoint_seq,
        submitted_timeline_seq,
        submitted_command_seq,
        submission,
        result_summary,
        replay_capability,
        transition_semantics,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36
      )
      ON CONFLICT (match_id, decision_id) DO NOTHING`,
      [
        input.matchId,
        record.decisionId,
        input.timelineSeq,
        record.decisionSchemaVersion ?? 1,
        record.decisionType,
        record.status,
        record.playerId ?? null,
        toJsonbParam(record.eventIds ?? []),
        record.sourceType ?? null,
        record.sourceCardObjectId ?? null,
        record.sourceCardCode ?? null,
        record.sourceBaseCardCode ?? null,
        record.sourceZone ?? null,
        record.sourceSlot ?? null,
        record.abilityId ?? null,
        record.triggerCondition ?? null,
        record.abilityCategory ?? null,
        record.abilitySourceZone ?? null,
        record.effectTextSnapshot ?? null,
        record.stepId ?? null,
        record.stepText ?? null,
        record.waitingSeat ?? null,
        toJsonbParam(record.visibleCandidates ?? []),
        toJsonbParam(record.auditCandidates ?? []),
        record.visibleContextSummary ? toJsonbParam(record.visibleContextSummary) : null,
        record.minSelect ?? null,
        record.maxSelect ?? null,
        record.canSkip ?? null,
        record.openedCheckpointSeq ??
          (record.status === 'OPENED' ? input.defaultCheckpointSeq : null),
        record.submittedTimelineSeq ?? (record.status === 'SUBMITTED' ? input.timelineSeq : null),
        record.submittedCommandSeq ?? input.defaultCommandSeq,
        record.submission ? toJsonbParam(record.submission) : null,
        record.resultSummary ?? null,
        record.replayCapability ?? 'DECISION_RECORDS_PARTIAL',
        record.transitionSemantics,
        toDate(input.createdAt),
      ]
    );
  }
}

async function insertAuthorityCheckpoint(
  client: MatchRecorderQueryClient,
  input: {
    readonly matchId: string;
    readonly checkpointSeq: number;
    readonly timelineSeq: number;
    readonly authorityState: GameState;
    readonly relatedPublicSeq: number | null;
    readonly relatedCommandSeq: number | null;
    readonly relatedGameEventSeq: number | null;
    readonly createdAt: number;
  }
): Promise<string> {
  const payloadEnvelope = serializeReplayPayload(
    input.authorityState,
    'AUTHORITY_GAME_STATE',
    GAME_STATE_SCHEMA_VERSION
  );

  await client.query(
    `INSERT INTO match_checkpoints (
      match_id,
      checkpoint_seq,
      timeline_seq,
      checkpoint_type,
      related_public_seq,
      related_command_seq,
      related_game_event_seq,
      turn_count,
      phase,
      sub_phase,
      schema_version,
      payload,
      payload_compression,
      payload_hash,
      visibility_scope,
      capabilities,
      created_at
    ) VALUES ($1, $2, $3, 'AUTHORITY', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ADMIN', $14, $15)`,
    [
      input.matchId,
      input.checkpointSeq,
      input.timelineSeq,
      input.relatedPublicSeq,
      input.relatedCommandSeq,
      input.relatedGameEventSeq,
      input.authorityState.turnCount,
      String(input.authorityState.currentPhase),
      String(input.authorityState.currentSubPhase),
      GAME_STATE_SCHEMA_VERSION,
      toJsonbParam(payloadEnvelope),
      payloadEnvelope.compression,
      payloadEnvelope.payloadHash,
      toJsonbParam(DEFAULT_REPLAY_CAPABILITIES),
      toDate(input.createdAt),
    ]
  );

  return payloadEnvelope.payloadHash;
}

function buildDeckSnapshotInput(
  match: OnlineMatchState,
  seat: Seat,
  cardDataHash: string
): MatchRecorderDeckSnapshotInput {
  const snapshot = match.deckSnapshots[seat];
  const allCards = [...snapshot.mainDeck, ...snapshot.energyDeck];

  return {
    seat,
    userId: snapshot.userId,
    sourceDeckId: snapshot.sourceDeckId,
    sourceDeckName: snapshot.sourceDeckName,
    source: snapshot.source,
    mainDeck: snapshot.mainDeck.map((card) => card.cardCode),
    energyDeck: snapshot.energyDeck.map((card) => card.cardCode),
    cardSummaries: Object.fromEntries(allCards.map((card) => [card.cardCode, summarizeCard(card)])),
    validationState: 'RUNTIME_ACCEPTED',
    cardDataVersion: REPLAY_CARD_DATA_VERSION,
    cardDataHash,
    lockedAt: snapshot.lockedAt,
  };
}

function summarizeCard(card: AnyCardData): MatchRecorderCardSummary {
  return {
    cardCode: card.cardCode,
    name: card.name,
    cardType: card.cardType,
    ...(card.groupNames && card.groupNames.length > 0 ? { groupNames: card.groupNames } : {}),
    ...('unitName' in card && card.unitName ? { unitName: card.unitName } : {}),
    ...('cost' in card ? { cost: card.cost } : {}),
    ...('score' in card ? { score: card.score } : {}),
    ...(card.imageFilename ? { imageFilename: card.imageFilename } : {}),
    ...(card.rare ? { rare: card.rare } : {}),
    ...(card.product ? { product: card.product } : {}),
    ...(card.cardText ? { cardText: card.cardText } : {}),
  };
}

function buildRuntimeCardDataHashInput(match: OnlineMatchState): readonly unknown[] {
  return RECORDER_SEATS.flatMap((seat) =>
    [...match.deckSnapshots[seat].mainDeck, ...match.deckSnapshots[seat].energyDeck].map(
      (card) => ({
        seat,
        cardCode: card.cardCode,
        data: toReplayJsonValue(card),
      })
    )
  );
}

function assertSharedCardDataHash(
  deckSnapshots: Readonly<Record<Seat, MatchRecorderDeckSnapshotInput>>
): string {
  const hashes = new Set(RECORDER_SEATS.map((seat) => deckSnapshots[seat].cardDataHash));
  if (hashes.size !== 1) {
    throw new MatchRecorderServiceError(
      'MATCH_RECORDER_CARD_DATA_HASH_MISMATCH',
      '历史卡组快照卡牌数据 hash 不一致'
    );
  }
  return deckSnapshots.FIRST.cardDataHash;
}

function hashJsonValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`;
}

function toJsonbParam(value: unknown): string {
  return JSON.stringify(toReplayJsonValue(value)) ?? 'null';
}

function nullableSeq(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

function mapPrivateSeqBySeat(value: unknown): Readonly<Record<Seat, number>> {
  if (!value || typeof value !== 'object') {
    return { FIRST: 0, SECOND: 0 };
  }

  const seqs = value as Partial<Record<Seat, unknown>>;
  return {
    FIRST: typeof seqs.FIRST === 'number' ? seqs.FIRST : Number(seqs.FIRST ?? 0) || 0,
    SECOND: typeof seqs.SECOND === 'number' ? seqs.SECOND : Number(seqs.SECOND ?? 0) || 0,
  };
}

function mergePrivateSeqBySeat(
  current: Readonly<Record<Seat, number>>,
  next: Partial<Record<Seat, number>> | undefined
): Readonly<Record<Seat, number>> {
  return {
    FIRST: Math.max(current.FIRST, next?.FIRST ?? 0),
    SECOND: Math.max(current.SECOND, next?.SECOND ?? 0),
  };
}

function defaultVisibilityForFrame(
  frameType: AppendMatchRecordFrameInput['frameType']
): ReplayVisibilityScope {
  return frameType === 'SYSTEM_TRANSITION' || frameType.startsWith('UNDO_') ? 'SYSTEM' : 'PRIVATE';
}

function defaultSummaryForFrame(frameType: AppendMatchRecordFrameInput['frameType']): string {
  switch (frameType) {
    case 'COMMAND_ACCEPTED':
      return '命令已接受并保存权威检查点';
    case 'COMMAND_REJECTED':
      return '命令被拒绝';
    case 'SYSTEM_TRANSITION':
      return '系统推进并保存权威检查点';
    case 'UNDO_REQUESTED':
      return '撤销请求已创建';
    case 'UNDO_ACCEPTED':
      return '撤销请求已接受';
    case 'UNDO_REJECTED':
      return '撤销请求已拒绝';
    case 'UNDO_EXPIRED':
      return '撤销请求已失效';
    case 'UNDO_APPLIED':
      return '撤销已应用并保存权威检查点';
  }
}

function buildTransitionDedupeKey(
  frameType: AppendMatchRecordFrameInput['frameType'],
  input: {
    readonly timelineSeq: number;
    readonly relatedPublicSeq: number | null;
    readonly relatedCommandSeq: number | null;
    readonly relatedGameEventSeq: number | null;
  }
): string {
  if (input.relatedCommandSeq) {
    return `${frameType}:command:${input.relatedCommandSeq}`;
  }
  if (input.relatedGameEventSeq) {
    return `${frameType}:game-event:${input.relatedGameEventSeq}`;
  }
  if (input.relatedPublicSeq) {
    return `${frameType}:public:${input.relatedPublicSeq}`;
  }
  return `${frameType}:timeline:${input.timelineSeq}`;
}

function summarizePublicEvent(event: PublicEvent): string {
  switch (event.type) {
    case 'PhaseStarted':
      return `阶段开始：${event.phase}`;
    case 'SubPhaseStarted':
      return `子阶段开始：${event.subPhase}`;
    case 'WindowStatusChanged':
      return `窗口${event.status}：${event.windowType ?? '无'}`;
    case 'PlayerDeclared':
      return `玩家宣言：${event.declarationType}`;
    case 'CardMovedPublic':
      return event.card?.name
        ? `公开移动：${event.card.name}`
        : `公开移动：${event.count ?? 1} 张卡`;
    case 'CardsInspectedSummary':
      return `检视 ${event.count} 张卡`;
    case 'CardRevealed':
      return `公开：${event.card.name ?? event.card.cardCode ?? '卡牌'}`;
    case 'CardRevealedAndMoved':
      return `公开并移动：${event.card.name ?? event.card.cardCode ?? '卡牌'}`;
    case 'DeckRefreshed':
      return `卡组刷新：${event.ownerSeat} 移动 ${event.movedCount} 张`;
  }
}

function summarizePrivateEvent(event: PrivateEvent): string {
  return `私密事件：${event.type}`;
}

function toDate(value: number): Date {
  return new Date(value);
}

function toNullableDate(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}
