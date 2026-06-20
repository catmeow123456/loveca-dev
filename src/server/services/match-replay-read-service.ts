import { createHash } from 'node:crypto';
import type { AnyCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { projectPlayerViewState } from '../../online/projector.js';
import type {
  MatchAutomationGameMode,
  MatchDecisionRecordStatus,
  MatchDecisionSubmissionSummary,
  MatchDecisionTransitionSemantics,
  MatchDecisionType,
  MatchDecisionVisibleContextSummary,
  MatchRecordDecisionView,
  MatchDeckSnapshotSource,
  MatchDeckSnapshotValidationState,
  MatchRecordTimelineEntryView,
  MatchRecordVisibleEventView,
  MatchRecordVisiblePrivateEventView,
  MatchRecordCompleteness,
  MatchRecordDetailView,
  MatchMode,
  MatchOriginKind,
  MatchParticipantKind,
  MatchRecordReplayView,
  MatchRecordStatus,
  MatchRecordSummaryView,
  MatchRecordTimelineView,
  ReplayCapability,
  ReplayCheckpointType,
  ReplayLimitation,
  ReplayRecordFrameType,
  ReplaySerializedPayloadEnvelope,
} from '../../online/replay-types.js';
import type { Seat } from '../../online/types.js';
import { GameMode } from '../../shared/types/enums.js';
import {
  GAME_STATE_SCHEMA_VERSION,
  REPLAY_CARD_DATA_VERSION,
  REPLAY_RECORD_SCHEMA_VERSION,
  REPLAY_RULES_VERSION,
} from './replay-constants.js';
import {
  ReplayPayloadSerializationError,
  rehydrateAuthorityGameState,
  stableJsonStringify,
  toReplayJsonValue,
} from './replay-payload-serialization.js';

const REPLAY_READ_SEATS: readonly Seat[] = ['FIRST', 'SECOND'];

interface MatchReplayReadQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface MatchReplayReadQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<MatchReplayReadQueryResult<T>>;
}

interface MatchReplayReadServiceDeps {
  readonly queryClient?: MatchReplayReadQueryClient;
}

interface RecordAccessRow {
  readonly match_id: string;
  readonly room_code: string;
  readonly match_mode: MatchMode;
  readonly automation_game_mode: MatchAutomationGameMode;
  readonly origin_kind: MatchOriginKind;
  readonly origin_label: string;
  readonly status: MatchRecordStatus;
  readonly completeness: MatchRecordCompleteness;
  readonly started_at: Date | string | number;
  readonly ended_at: Date | string | number | null;
  readonly sealed_at: Date | string | number | null;
  readonly winner_seat: Seat | null;
  readonly end_reason: string | null;
  readonly turn_count: number;
  readonly last_timeline_seq: number;
  readonly last_checkpoint_seq: number;
  readonly record_version: number;
  readonly rules_version: string;
  readonly card_data_version: string;
  readonly card_data_hash: string;
  readonly replay_capabilities: unknown;
  readonly replay_limitations: unknown;
  readonly partial_reason: string | null;
  readonly viewer_seat: Seat;
  readonly viewer_player_id: string;
  readonly opponent_seat: Seat | null;
  readonly opponent_user_id: string | null;
  readonly opponent_display_name: string | null;
}

interface ParticipantRow {
  readonly seat: Seat;
  readonly user_id: string;
  readonly display_name: string;
  readonly player_id: string;
  readonly participant_kind: MatchParticipantKind;
  readonly owner_user_id: string | null;
}

interface DeckSnapshotRow {
  readonly seat: Seat;
  readonly source_deck_id: string | null;
  readonly source_deck_name: string | null;
  readonly source: MatchDeckSnapshotSource;
  readonly main_deck: unknown;
  readonly energy_deck: unknown;
  readonly validation_state: MatchDeckSnapshotValidationState;
  readonly card_data_version: string;
  readonly card_data_hash: string;
  readonly locked_at: Date | string | number | null;
}

interface TimelineRow {
  readonly timeline_seq: number;
  readonly frame_type: ReplayRecordFrameType;
  readonly visibility_scope: string;
  readonly summary: string;
  readonly created_at: Date | string | number;
  readonly related_checkpoint_seq: number | null;
  readonly related_public_seq: number | null;
  readonly related_private_seq: number | null;
  readonly related_private_seq_by_seat: unknown;
  readonly related_command_seq: number | null;
  readonly related_game_event_seq: number | null;
  readonly turn_count: number;
  readonly phase: string;
  readonly sub_phase: string;
}

interface CheckpointRow {
  readonly checkpoint_seq: number;
  readonly timeline_seq: number;
  readonly checkpoint_type: ReplayCheckpointType;
  readonly related_public_seq: number | null;
  readonly related_command_seq: number | null;
  readonly related_game_event_seq: number | null;
  readonly turn_count: number;
  readonly phase: string;
  readonly sub_phase: string;
  readonly schema_version: string;
  readonly payload: ReplaySerializedPayloadEnvelope;
  readonly payload_hash: string;
  readonly capabilities: unknown;
  readonly created_at: Date | string | number;
}

interface DeckSnapshotCompatibilityRow {
  readonly seat: Seat;
  readonly main_deck: unknown;
  readonly energy_deck: unknown;
  readonly card_data_version: string;
  readonly card_data_hash: string;
}

interface PublicEventRow {
  readonly timeline_seq: number;
  readonly event_seq: number;
  readonly event_id: string;
  readonly event_type: string;
  readonly source: string | null;
  readonly actor_seat: Seat | null;
  readonly summary: string;
  readonly payload: unknown;
  readonly created_at: Date | string | number;
  readonly turn_count: number;
  readonly phase: string;
  readonly sub_phase: string;
}

interface PrivateEventRow {
  readonly timeline_seq: number;
  readonly event_seq: number;
  readonly event_id: string;
  readonly event_type: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly created_at: Date | string | number;
  readonly turn_count: number;
  readonly phase: string;
  readonly sub_phase: string;
}

interface DecisionRecordRow {
  readonly decision_id: string;
  readonly timeline_seq: number;
  readonly decision_schema_version: number;
  readonly decision_type: MatchDecisionType;
  readonly status: MatchDecisionRecordStatus;
  readonly player_id: string | null;
  readonly event_ids: unknown;
  readonly ability_id: string | null;
  readonly source_card_object_id: string | null;
  readonly source_card_code: string | null;
  readonly source_base_card_code: string | null;
  readonly source_zone: string | null;
  readonly source_slot: string | null;
  readonly effect_text_snapshot: string | null;
  readonly step_id: string | null;
  readonly step_text: string | null;
  readonly waiting_seat: Seat | null;
  readonly visible_candidates: unknown;
  readonly visible_context_summary: unknown;
  readonly min_select: number | null;
  readonly max_select: number | null;
  readonly can_skip: boolean | null;
  readonly submitted_timeline_seq: number | null;
  readonly submitted_command_seq: number | null;
  readonly submission: unknown;
  readonly result_summary: string | null;
  readonly replay_capability: ReplayCapability;
  readonly transition_semantics: MatchDecisionTransitionSemantics;
  readonly created_at: Date | string | number;
}

export class MatchReplayReadServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'MatchReplayReadServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class MatchReplayReadService {
  private readonly queryClient: MatchReplayReadQueryClient;

  constructor(deps: MatchReplayReadServiceDeps = {}) {
    this.queryClient = deps.queryClient ?? createDefaultQueryClient();
  }

  async listMatchRecordsForUser(
    userId: string,
    options: { readonly limit?: number; readonly offset?: number } = {}
  ): Promise<readonly MatchRecordSummaryView[]> {
    const limit = clampListLimit(options.limit);
    const offset = clampOffset(options.offset);
    const result = await this.queryClient.query<RecordAccessRow>(
      `${recordAccessSelectSql()}
      WHERE viewer.user_id = $1
      ORDER BY record.started_at DESC, record.match_id ASC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows.map(mapRecordSummaryRow);
  }

  async getMatchRecordDetail(
    matchId: string,
    userId: string
  ): Promise<MatchRecordDetailView | null> {
    const access = await this.getRecordAccess(matchId, userId);
    if (!access) {
      return null;
    }

    const [participants, deckSnapshots] = await Promise.all([
      this.queryClient.query<ParticipantRow>(
        `SELECT seat, user_id, display_name, player_id, participant_kind, owner_user_id
        FROM match_participants
        WHERE match_id = $1
        ORDER BY seat`,
        [matchId]
      ),
      this.queryClient.query<DeckSnapshotRow>(
        `SELECT
          seat,
          source_deck_id,
          source_deck_name,
          source,
          main_deck,
          energy_deck,
          validation_state,
          card_data_version,
          card_data_hash,
          locked_at
        FROM match_deck_snapshots
        WHERE match_id = $1
        ORDER BY seat`,
        [matchId]
      ),
    ]);

    return {
      ...mapRecordSummaryRow(access),
      participants: participants.rows.map((row) => ({
        seat: row.seat,
        userId: row.user_id,
        displayName: row.display_name,
        playerId: row.player_id,
        participantKind: row.participant_kind,
        ownerUserId: row.owner_user_id,
      })),
      deckSnapshots: deckSnapshots.rows.map((row) => ({
        seat: row.seat,
        sourceDeckId: row.source_deck_id,
        sourceDeckName: row.source_deck_name,
        source: row.source,
        mainDeckCount: readJsonArrayLength(row.main_deck),
        energyDeckCount: readJsonArrayLength(row.energy_deck),
        validationState: row.validation_state,
        cardDataVersion: row.card_data_version,
        cardDataHash: row.card_data_hash,
        lockedAt: nullableDateToMs(row.locked_at),
      })),
    };
  }

  async getMatchRecordTimeline(
    matchId: string,
    userId: string
  ): Promise<MatchRecordTimelineView | null> {
    const access = await this.getRecordAccess(matchId, userId);
    if (!access) {
      return null;
    }

    const timeline = await this.queryClient.query<TimelineRow>(
      `SELECT
        timeline_seq,
        frame_type,
        visibility_scope,
        summary,
        created_at,
        related_checkpoint_seq,
        related_public_seq,
        related_private_seq,
        related_private_seq_by_seat,
        related_command_seq,
        related_game_event_seq,
        turn_count,
        phase,
        sub_phase
      FROM match_timeline_entries
      WHERE match_id = $1
        AND (
          visibility_scope IN ('PUBLIC', 'PRIVATE', 'SYSTEM')
          OR related_checkpoint_seq IS NOT NULL
        )
      ORDER BY timeline_seq ASC`,
      [matchId]
    );

    return {
      matchId,
      matchMode: access.match_mode,
      automationGameMode: access.automation_game_mode,
      originKind: access.origin_kind,
      originLabel: access.origin_label,
      viewerSeat: access.viewer_seat,
      recordStatus: access.status,
      recordCompleteness: access.completeness,
      replayLimitations: readLimitations(access.replay_limitations),
      partialReasonSummary: sanitizePartialReason(access.partial_reason),
      timelineSummary: filterTimelineRowsForViewer(timeline.rows, access.viewer_seat).map((row) =>
        mapTimelineRow(row, access.viewer_seat)
      ),
    };
  }

  async getMatchRecordReplay(
    matchId: string,
    userId: string,
    checkpointSeq?: number
  ): Promise<MatchRecordReplayView | null> {
    const access = await this.getRecordAccess(matchId, userId);
    if (!access) {
      return null;
    }
    validateRecordCompatibility(access);

    const checkpoint = await this.getAuthorityCheckpoint(matchId, checkpointSeq);
    if (!checkpoint) {
      throw new MatchReplayReadServiceError(
        'MATCH_RECORD_CHECKPOINT_NOT_FOUND',
        '历史对局检查点不存在',
        404
      );
    }
    if (checkpoint.payload_hash !== checkpoint.payload.payloadHash) {
      throw new MatchReplayReadServiceError(
        'MATCH_RECORD_CHECKPOINT_CORRUPTED',
        '历史对局检查点 hash 不一致',
        409
      );
    }
    validateCheckpointCompatibility(checkpoint);

    const authorityState = rehydrateAuthorityCheckpoint(checkpoint);
    validateCheckpointMatchesAuthorityState(matchId, checkpoint, authorityState);
    await this.validateCardDataCompatibility(matchId, access, authorityState);
    const playerViewState = projectPlayerViewState(authorityState, access.viewer_player_id, {
      seq: checkpoint.related_public_seq ?? 0,
      gameMode: toProjectorGameMode(access.automation_game_mode),
    });
    const frame = await this.getTimelineFrame(matchId, checkpoint.timeline_seq);
    const mappedFrame = frame ? mapTimelineRow(frame, access.viewer_seat) : null;
    const [publicEvents, privateEvents, decisionRecords] = await Promise.all([
      this.getPublicEventRowsThrough(matchId, checkpoint.timeline_seq),
      this.getPrivateEventRowsThrough(matchId, access.viewer_seat, checkpoint.timeline_seq),
      this.getDecisionRecordRowsThrough(matchId, access.viewer_seat, checkpoint.timeline_seq),
    ]);

    return {
      matchId,
      sourceMatchMode: access.match_mode,
      automationGameMode: access.automation_game_mode,
      originKind: access.origin_kind,
      originLabel: access.origin_label,
      viewerSeat: access.viewer_seat,
      replayPosition: {
        timelineSeq: checkpoint.timeline_seq,
        checkpointSeq: checkpoint.checkpoint_seq,
      },
      timelineSummary: mappedFrame,
      recordFrame: mappedFrame,
      visibleEvents: publicEvents.map(mapPublicEventRow),
      visiblePrivateEvents: privateEvents.map(mapPrivateEventRow),
      visibleDecisions: decisionRecords.map(mapDecisionRecordRow),
      checkpointInfo: {
        matchId,
        checkpointSeq: checkpoint.checkpoint_seq,
        timelineSeq: checkpoint.timeline_seq,
        checkpointType: checkpoint.checkpoint_type,
        relatedPublicSeq: checkpoint.related_public_seq,
        relatedCommandSeq: checkpoint.related_command_seq,
        relatedGameEventSeq: checkpoint.related_game_event_seq,
        turnCount: checkpoint.turn_count,
        phase: checkpoint.phase,
        subPhase: checkpoint.sub_phase,
        createdAt: dateToMs(checkpoint.created_at),
        capabilities: readCapabilities(checkpoint.capabilities),
      },
      playerViewState,
      recordStatus: access.status,
      recordCompleteness: access.completeness,
      replayLimitations: readLimitations(access.replay_limitations),
      partialReasonSummary: sanitizePartialReason(access.partial_reason),
    };
  }

  private async getRecordAccess(matchId: string, userId: string): Promise<RecordAccessRow | null> {
    const result = await this.queryClient.query<RecordAccessRow>(
      `${recordAccessSelectSql()}
      WHERE record.match_id = $1 AND viewer.user_id = $2
      LIMIT 1`,
      [matchId, userId]
    );
    return result.rows[0] ?? null;
  }

  private async getAuthorityCheckpoint(
    matchId: string,
    checkpointSeq: number | undefined
  ): Promise<CheckpointRow | null> {
    const values: unknown[] = [matchId];
    const checkpointFilter =
      typeof checkpointSeq === 'number' && checkpointSeq > 0 ? 'AND checkpoint_seq = $2' : '';
    if (checkpointFilter) {
      values.push(checkpointSeq);
    }

    const result = await this.queryClient.query<CheckpointRow>(
      `SELECT
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
        payload_hash,
        capabilities,
        created_at
      FROM match_checkpoints
      WHERE match_id = $1
        AND checkpoint_type = 'AUTHORITY'
        ${checkpointFilter}
      ORDER BY checkpoint_seq DESC
      LIMIT 1`,
      values
    );

    return result.rows[0] ?? null;
  }

  private async validateCardDataCompatibility(
    matchId: string,
    access: RecordAccessRow,
    authorityState: GameState
  ): Promise<void> {
    const snapshots = await this.queryClient.query<DeckSnapshotCompatibilityRow>(
      `SELECT
        seat,
        main_deck,
        energy_deck,
        card_data_version,
        card_data_hash
      FROM match_deck_snapshots
      WHERE match_id = $1
      ORDER BY seat`,
      [matchId]
    );

    validateDeckSnapshotsCompatibility(access, snapshots.rows, authorityState);
  }

  private async getTimelineFrame(
    matchId: string,
    timelineSeq: number
  ): Promise<TimelineRow | null> {
    const result = await this.queryClient.query<TimelineRow>(
      `SELECT
        timeline_seq,
        frame_type,
        visibility_scope,
        summary,
        created_at,
        related_checkpoint_seq,
        related_public_seq,
        related_private_seq,
        related_private_seq_by_seat,
        related_command_seq,
        related_game_event_seq,
        turn_count,
        phase,
        sub_phase
      FROM match_timeline_entries
      WHERE match_id = $1 AND timeline_seq = $2
      LIMIT 1`,
      [matchId, timelineSeq]
    );

    return result.rows[0] ?? null;
  }

  private async getPublicEventRowsThrough(
    matchId: string,
    timelineSeq: number
  ): Promise<readonly PublicEventRow[]> {
    const result = await this.queryClient.query<PublicEventRow>(
      `SELECT
        event.timeline_seq,
        event.event_seq,
        event.event_id,
        event.event_type,
        event.source,
        event.actor_seat,
        event.summary,
        event.payload,
        event.created_at,
        frame.turn_count,
        frame.phase,
        frame.sub_phase
      FROM match_record_public_events event
      INNER JOIN match_timeline_entries frame
        ON frame.match_id = event.match_id
        AND frame.timeline_seq = event.timeline_seq
      WHERE event.match_id = $1
        AND event.timeline_seq <= $2
      ORDER BY event.timeline_seq ASC, event.event_seq ASC`,
      [matchId, timelineSeq]
    );

    return result.rows;
  }

  private async getPrivateEventRowsThrough(
    matchId: string,
    viewerSeat: Seat,
    timelineSeq: number
  ): Promise<readonly PrivateEventRow[]> {
    const result = await this.queryClient.query<PrivateEventRow>(
      `SELECT
        event.timeline_seq,
        event.event_seq,
        event.event_id,
        event.event_type,
        event.summary,
        event.payload,
        event.created_at,
        frame.turn_count,
        frame.phase,
        frame.sub_phase
      FROM match_record_private_events event
      INNER JOIN match_timeline_entries frame
        ON frame.match_id = event.match_id
        AND frame.timeline_seq = event.timeline_seq
      WHERE event.match_id = $1
        AND event.seat = $2
        AND event.timeline_seq <= $3
      ORDER BY event.timeline_seq ASC, event.event_seq ASC`,
      [matchId, viewerSeat, timelineSeq]
    );

    return result.rows;
  }

  private async getDecisionRecordRowsThrough(
    matchId: string,
    viewerSeat: Seat,
    timelineSeq: number
  ): Promise<readonly DecisionRecordRow[]> {
    const result = await this.queryClient.query<DecisionRecordRow>(
      `SELECT
        decision_id,
        timeline_seq,
        decision_schema_version,
        decision_type,
        status,
        player_id,
        event_ids,
        ability_id,
        source_card_object_id,
        source_card_code,
        source_base_card_code,
        source_zone,
        source_slot,
        effect_text_snapshot,
        step_id,
        step_text,
        waiting_seat,
        visible_candidates,
        visible_context_summary,
        min_select,
        max_select,
        can_skip,
        submitted_timeline_seq,
        submitted_command_seq,
        submission,
        result_summary,
        replay_capability,
        transition_semantics,
        created_at
      FROM match_decision_records
      WHERE match_id = $1
        AND timeline_seq <= $3
        AND (waiting_seat IS NULL OR waiting_seat = $2)
      ORDER BY timeline_seq ASC, decision_id ASC`,
      [matchId, viewerSeat, timelineSeq]
    );

    return result.rows;
  }
}

export const matchReplayReadService = new MatchReplayReadService();

function recordAccessSelectSql(): string {
  return `SELECT
    record.match_id,
    record.room_code,
    record.match_mode,
    record.automation_game_mode,
    record.origin_kind,
    record.origin_label,
    record.status,
    record.completeness,
    record.started_at,
    record.ended_at,
    record.sealed_at,
    record.winner_seat,
    record.end_reason,
    record.turn_count,
    record.last_timeline_seq,
    record.last_checkpoint_seq,
    record.record_version,
    record.rules_version,
    record.card_data_version,
    record.card_data_hash,
    record.replay_capabilities,
    record.replay_limitations,
    record.partial_reason,
    viewer.seat AS viewer_seat,
    viewer.player_id AS viewer_player_id,
    opponent.seat AS opponent_seat,
    opponent.user_id AS opponent_user_id,
    opponent.display_name AS opponent_display_name
  FROM match_records record
  INNER JOIN match_participants viewer
    ON viewer.match_id = record.match_id
    AND viewer.participant_kind = 'USER'
  LEFT JOIN match_participants opponent
    ON opponent.match_id = record.match_id
    AND opponent.seat <> viewer.seat`;
}

function validateRecordCompatibility(access: RecordAccessRow): void {
  if (access.record_version !== REPLAY_RECORD_SCHEMA_VERSION) {
    throw new MatchReplayReadServiceError(
      'MATCH_RECORD_SCHEMA_UNSUPPORTED',
      '历史对局记录版本不兼容',
      409
    );
  }
  if (access.rules_version !== REPLAY_RULES_VERSION) {
    throw new MatchReplayReadServiceError(
      'MATCH_RECORD_RULES_UNSUPPORTED',
      '历史对局规则版本不兼容',
      409
    );
  }
  if (access.card_data_version !== REPLAY_CARD_DATA_VERSION) {
    throw new MatchReplayReadServiceError(
      'MATCH_RECORD_CARD_DATA_UNSUPPORTED',
      '历史对局卡牌数据版本不兼容',
      409
    );
  }
}

function validateCheckpointCompatibility(checkpoint: CheckpointRow): void {
  if (
    checkpoint.schema_version !== GAME_STATE_SCHEMA_VERSION ||
    checkpoint.payload.sourceSchemaVersion !== GAME_STATE_SCHEMA_VERSION
  ) {
    throw new MatchReplayReadServiceError(
      'MATCH_RECORD_CHECKPOINT_UNSUPPORTED',
      '历史对局权威状态版本不兼容',
      409
    );
  }
}

function rehydrateAuthorityCheckpoint(checkpoint: CheckpointRow): GameState {
  try {
    return rehydrateAuthorityGameState(checkpoint.payload);
  } catch (error) {
    if (error instanceof ReplayPayloadSerializationError) {
      const isIntegrityError =
        error.message.includes('hash') || error.message.includes('byte length');
      throw new MatchReplayReadServiceError(
        isIntegrityError
          ? 'MATCH_RECORD_CHECKPOINT_CORRUPTED'
          : 'MATCH_RECORD_CHECKPOINT_UNSUPPORTED',
        isIntegrityError ? '历史对局检查点内容损坏' : '历史对局检查点序列化格式不兼容',
        409
      );
    }
    throw error;
  }
}

function validateCheckpointMatchesAuthorityState(
  matchId: string,
  checkpoint: CheckpointRow,
  authorityState: GameState
): void {
  if (
    authorityState.gameId !== matchId ||
    checkpoint.turn_count !== authorityState.turnCount ||
    checkpoint.phase !== String(authorityState.currentPhase) ||
    checkpoint.sub_phase !== String(authorityState.currentSubPhase)
  ) {
    throw new MatchReplayReadServiceError(
      'MATCH_RECORD_CHECKPOINT_MISMATCH',
      '历史对局检查点与权威状态不一致',
      409
    );
  }
}

function validateDeckSnapshotsCompatibility(
  access: RecordAccessRow,
  rows: readonly DeckSnapshotCompatibilityRow[],
  authorityState: GameState
): void {
  const snapshotsBySeat = new Map(rows.map((row) => [row.seat, row] as const));
  for (const seat of REPLAY_READ_SEATS) {
    const snapshot = snapshotsBySeat.get(seat);
    if (!snapshot) {
      throw new MatchReplayReadServiceError(
        'MATCH_RECORD_CARD_DATA_HASH_MISMATCH',
        '历史对局卡组快照不完整',
        409
      );
    }
    if (snapshot.card_data_version !== access.card_data_version) {
      throw new MatchReplayReadServiceError(
        'MATCH_RECORD_CARD_DATA_UNSUPPORTED',
        '历史对局卡组快照卡牌数据版本不一致',
        409
      );
    }
    if (snapshot.card_data_hash !== access.card_data_hash) {
      throw new MatchReplayReadServiceError(
        'MATCH_RECORD_CARD_DATA_HASH_MISMATCH',
        '历史对局卡组快照卡牌数据 hash 不一致',
        409
      );
    }
  }

  const expectedHash = hashJsonValue(buildRecordCardDataHashInput(snapshotsBySeat, authorityState));
  if (expectedHash !== access.card_data_hash) {
    throw new MatchReplayReadServiceError(
      'MATCH_RECORD_CARD_DATA_HASH_MISMATCH',
      '历史对局卡牌数据 hash 校验失败',
      409
    );
  }
}

function buildRecordCardDataHashInput(
  snapshotsBySeat: ReadonlyMap<Seat, DeckSnapshotCompatibilityRow>,
  authorityState: GameState
): readonly unknown[] {
  const cardDataByCode = new Map<string, AnyCardData>();
  for (const card of authorityState.cardRegistry.values()) {
    if (!cardDataByCode.has(card.data.cardCode)) {
      cardDataByCode.set(card.data.cardCode, card.data as AnyCardData);
    }
  }

  return REPLAY_READ_SEATS.flatMap((seat) => {
    const snapshot = snapshotsBySeat.get(seat);
    if (!snapshot) {
      throw new MatchReplayReadServiceError(
        'MATCH_RECORD_CARD_DATA_HASH_MISMATCH',
        '历史对局卡组快照不完整',
        409
      );
    }

    return [
      ...readJsonArray<string>(snapshot.main_deck),
      ...readJsonArray<string>(snapshot.energy_deck),
    ].map((cardCode) => {
      const cardData = cardDataByCode.get(cardCode);
      if (!cardData) {
        throw new MatchReplayReadServiceError(
          'MATCH_RECORD_CARD_DATA_HASH_MISMATCH',
          `历史对局卡组快照引用了不存在的卡牌: ${cardCode}`,
          409
        );
      }

      return {
        seat,
        cardCode,
        data: toReplayJsonValue(cardData),
      };
    });
  });
}

function hashJsonValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`;
}

function mapRecordSummaryRow(row: RecordAccessRow): MatchRecordSummaryView {
  return {
    matchId: row.match_id,
    roomCode: row.room_code,
    matchMode: row.match_mode,
    automationGameMode: row.automation_game_mode,
    originKind: row.origin_kind,
    originLabel: row.origin_label,
    status: row.status,
    completeness: row.completeness,
    startedAt: dateToMs(row.started_at),
    endedAt: nullableDateToMs(row.ended_at),
    sealedAt: nullableDateToMs(row.sealed_at),
    viewerSeat: row.viewer_seat,
    opponentSeat: row.opponent_seat,
    opponentUserId: row.opponent_user_id,
    opponentDisplayName: row.opponent_display_name,
    winnerSeat: row.winner_seat,
    endReason: row.end_reason,
    turnCount: row.turn_count,
    lastTimelineSeq: row.last_timeline_seq,
    lastCheckpointSeq: row.last_checkpoint_seq,
    replayCapabilities: readCapabilities(row.replay_capabilities),
    replayLimitations: readLimitations(row.replay_limitations),
    partialReasonSummary: sanitizePartialReason(row.partial_reason),
  };
}

function mapTimelineRow(row: TimelineRow, viewerSeat: Seat): MatchRecordTimelineEntryView {
  return {
    timelineSeq: row.timeline_seq,
    frameType: row.frame_type,
    visibilityScope: getTimelineVisibilityScopeForViewer(row),
    summary: getTimelineSummaryForViewer(row),
    createdAt: dateToMs(row.created_at),
    relatedCheckpointSeq: row.related_checkpoint_seq,
    relatedPublicSeq: row.related_public_seq,
    relatedPrivateSeq: row.related_private_seq,
    relatedPrivateSeqForViewer: readPrivateSeqForSeat(row, viewerSeat),
    relatedCommandSeq: row.related_command_seq,
    relatedGameEventSeq: row.related_game_event_seq,
    turnCount: row.turn_count,
    phase: row.phase,
    subPhase: row.sub_phase,
  };
}

function getTimelineVisibilityScopeForViewer(
  row: TimelineRow
): MatchRecordTimelineEntryView['visibilityScope'] {
  return isAdminCheckpointTimelineRow(row)
    ? 'SYSTEM'
    : (row.visibility_scope as MatchRecordTimelineEntryView['visibilityScope']);
}

function getTimelineSummaryForViewer(row: TimelineRow): string {
  return isAdminCheckpointTimelineRow(row) ? '历史检查点' : row.summary;
}

function isAdminCheckpointTimelineRow(row: TimelineRow): boolean {
  return row.visibility_scope === 'ADMIN' && row.related_checkpoint_seq !== null;
}

function filterTimelineRowsForViewer(
  rows: readonly TimelineRow[],
  viewerSeat: Seat
): readonly TimelineRow[] {
  let lastPrivateSeqForViewer = 0;

  return rows.filter((row) => {
    const privateSeqForViewer = readPrivateSeqForSeat(row, viewerSeat);
    const hasNewPrivateEventsForViewer = privateSeqForViewer > lastPrivateSeqForViewer;
    lastPrivateSeqForViewer = Math.max(lastPrivateSeqForViewer, privateSeqForViewer);

    return (
      row.visibility_scope === 'PUBLIC' ||
      row.visibility_scope === 'SYSTEM' ||
      row.related_checkpoint_seq !== null ||
      (row.visibility_scope === 'PRIVATE' && hasNewPrivateEventsForViewer)
    );
  });
}

function mapPublicEventRow(row: PublicEventRow): MatchRecordVisibleEventView {
  return {
    timelineSeq: row.timeline_seq,
    eventSeq: row.event_seq,
    eventId: row.event_id,
    eventType: row.event_type,
    summary: row.summary,
    createdAt: dateToMs(row.created_at),
    actorSeat: row.actor_seat,
    source: row.source,
    payload: row.payload,
    turnCount: row.turn_count,
    phase: row.phase,
    subPhase: row.sub_phase,
  };
}

function mapPrivateEventRow(row: PrivateEventRow): MatchRecordVisiblePrivateEventView {
  return {
    timelineSeq: row.timeline_seq,
    eventSeq: row.event_seq,
    eventId: row.event_id,
    eventType: row.event_type,
    summary: row.summary,
    createdAt: dateToMs(row.created_at),
    payload: row.payload,
    turnCount: row.turn_count,
    phase: row.phase,
    subPhase: row.sub_phase,
  };
}

function mapDecisionRecordRow(row: DecisionRecordRow): MatchRecordDecisionView {
  return {
    decisionId: row.decision_id,
    timelineSeq: row.timeline_seq,
    decisionSchemaVersion: row.decision_schema_version,
    decisionType: row.decision_type,
    status: row.status,
    playerId: row.player_id,
    eventIds: readJsonArray<string>(row.event_ids),
    abilityId: row.ability_id,
    sourceCardObjectId: row.source_card_object_id,
    sourceCardCode: row.source_card_code,
    sourceBaseCardCode: row.source_base_card_code,
    sourceZone: row.source_zone,
    sourceSlot: row.source_slot,
    effectTextSnapshot: row.effect_text_snapshot,
    stepId: row.step_id,
    stepText: row.step_text,
    waitingSeat: row.waiting_seat,
    visibleCandidates: readJsonArray(row.visible_candidates),
    visibleContextSummary: readJsonObject<MatchDecisionVisibleContextSummary>(
      row.visible_context_summary
    ),
    minSelect: row.min_select,
    maxSelect: row.max_select,
    canSkip: row.can_skip,
    submittedTimelineSeq: row.submitted_timeline_seq,
    submittedCommandSeq: row.submitted_command_seq,
    submission: readJsonObject<MatchDecisionSubmissionSummary>(row.submission),
    resultSummary: row.result_summary,
    replayCapability: row.replay_capability,
    transitionSemantics: row.transition_semantics,
    createdAt: dateToMs(row.created_at),
  };
}

function readPrivateSeqForSeat(row: TimelineRow, seat: Seat): number {
  return readPrivateSeqBySeat(row.related_private_seq_by_seat)[seat];
}

function readPrivateSeqBySeat(value: unknown): Readonly<Record<Seat, number>> {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!parsed || typeof parsed !== 'object') {
    return { FIRST: 0, SECOND: 0 };
  }

  const seqs = parsed as Partial<Record<Seat, unknown>>;
  return {
    FIRST: coerceSeq(seqs.FIRST),
    SECOND: coerceSeq(seqs.SECOND),
  };
}

function readCapabilities(value: unknown): readonly ReplayCapability[] {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  return Array.isArray(parsed)
    ? (parsed.filter((entry) => typeof entry === 'string') as ReplayCapability[])
    : [];
}

function readLimitations(value: unknown): readonly ReplayLimitation[] {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  return Array.isArray(parsed)
    ? (parsed.filter((entry) => typeof entry === 'string') as ReplayLimitation[])
    : [];
}

function toProjectorGameMode(value: MatchAutomationGameMode): GameMode {
  return value === 'SOLITAIRE' ? GameMode.SOLITAIRE : GameMode.DEBUG;
}

function readJsonArrayLength(value: unknown): number {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  return Array.isArray(parsed) ? parsed.length : 0;
}

function readJsonArray<T>(value: unknown): readonly T[] {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function readJsonObject<T extends object>(value: unknown): T | null {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function coerceSeq(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }
  return 0;
}

function sanitizePartialReason(partialReason: string | null): string | null {
  return partialReason ? '记录不完整，部分回放节点可能缺失' : null;
}

function clampListLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return 50;
  }
  return Math.min(100, Math.max(1, value));
}

function clampOffset(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function nullableDateToMs(value: Date | string | number | null): number | null {
  return value === null ? null : dateToMs(value);
}

function dateToMs(value: Date | string | number): number {
  if (typeof value === 'number') {
    return value;
  }
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function createDefaultQueryClient(): MatchReplayReadQueryClient {
  return {
    async query<T = unknown>(
      text: string,
      values?: readonly unknown[]
    ): Promise<MatchReplayReadQueryResult<T>> {
      const { pool } = await import('../db/pool.js');
      const result = await pool.query(text, values ? [...values] : undefined);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount,
      };
    },
  };
}
