import { createGameSession } from '../../application/game-session.js';
import type { AnyCardData, CardInstance } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import type { PublicEvent, Seat } from '../../online/types.js';
import type {
  MatchAutomationGameMode,
  MatchDeckSnapshotSource,
  MatchMode,
  MatchOriginKind,
  MatchParticipantKind,
  RuntimeRecoveryInfo,
} from '../../online/index.js';
import { PUBLIC_EVENTS_RESPONSE_MAX, type OnlineMatchState } from './online-match-service.js';
import { rehydrateAuthorityGameState } from './replay-payload-serialization.js';
import type { ReplaySerializedPayloadEnvelope } from '../../online/replay-types.js';
import { pool } from '../db/pool.js';
import { GameMode } from '../../shared/types/enums.js';

interface SolitaireRuntimeRecoveryServiceDeps {
  readonly now?: () => number;
  readonly queryClient?: SolitaireRuntimeRecoveryQueryClient;
  readonly publicEventTailLimit?: number;
}

export interface SolitaireRuntimeRecoveryQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface SolitaireRuntimeRecoveryQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<SolitaireRuntimeRecoveryQueryResult<T>>;
}

interface RecoveryRecordRow {
  readonly match_id: string;
  readonly room_code: string;
  readonly match_mode: MatchMode;
  readonly automation_game_mode: MatchAutomationGameMode;
  readonly origin_kind: MatchOriginKind;
  readonly origin_label: string;
  readonly status: string;
  readonly started_at: Date | string | number;
  readonly updated_at: Date | string | number;
  readonly last_timeline_seq: number;
  readonly last_checkpoint_seq: number;
  readonly last_public_seq: number;
  readonly last_private_seq_by_seat: unknown;
  readonly last_audit_seq: number;
  readonly last_command_seq: number;
  readonly last_game_event_seq: number;
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
  readonly user_id: string;
  readonly source_deck_id: string | null;
  readonly source_deck_name: string | null;
  readonly source: MatchDeckSnapshotSource;
  readonly main_deck: unknown;
  readonly energy_deck: unknown;
  readonly locked_at: Date | string | number | null;
}

interface CheckpointRow {
  readonly checkpoint_seq: number;
  readonly timeline_seq: number;
  readonly related_public_seq: number | null;
  readonly related_command_seq: number | null;
  readonly related_game_event_seq: number | null;
  readonly payload: ReplaySerializedPayloadEnvelope;
  readonly payload_compression: string;
}

interface PublicEventRow {
  readonly timeline_seq: number;
  readonly event_seq: number;
  readonly payload: unknown;
}

export interface SolitaireRecoveredMatch {
  readonly match: OnlineMatchState;
  readonly recovery: RuntimeRecoveryInfo;
}

export class SolitaireRuntimeRecoveryServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'SolitaireRuntimeRecoveryServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class SolitaireRuntimeRecoveryService {
  private readonly now: () => number;
  private readonly queryClient: SolitaireRuntimeRecoveryQueryClient;
  private readonly publicEventTailLimit: number;

  constructor(deps: SolitaireRuntimeRecoveryServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.queryClient = deps.queryClient ?? pool;
    this.publicEventTailLimit = deps.publicEventTailLimit ?? PUBLIC_EVENTS_RESPONSE_MAX;
  }

  async recoverMatch(matchId: string, userId: string): Promise<SolitaireRecoveredMatch | null> {
    const record = await this.getRecoveryRecord(matchId, userId);
    if (!record || record.status !== 'IN_PROGRESS') {
      return null;
    }

    const [participants, deckSnapshots, checkpoint] = await Promise.all([
      this.getParticipants(matchId),
      this.getDeckSnapshots(matchId),
      this.getLatestAuthorityCheckpoint(matchId),
    ]);
    if (!checkpoint) {
      throw new SolitaireRuntimeRecoveryServiceError(
        'SOLITAIRE_MATCH_RECOVERY_CHECKPOINT_MISSING',
        '对墙打缺少可恢复的权威检查点',
        409
      );
    }
    if (checkpoint.payload_compression !== checkpoint.payload.compression) {
      throw new SolitaireRuntimeRecoveryServiceError(
        'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
        '对墙打检查点数据已损坏，无法恢复',
        409
      );
    }

    let authorityState: GameState;
    try {
      authorityState = rehydrateAuthorityGameState(checkpoint.payload);
    } catch (error) {
      throw new SolitaireRuntimeRecoveryServiceError(
        'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
        '对墙打检查点复水失败，无法恢复',
        409
      );
    }

    const participantMap = buildParticipantMap(participants);
    const firstParticipant = participantMap.FIRST;
    if (
      !firstParticipant ||
      firstParticipant.userId !== userId ||
      firstParticipant.participantKind !== 'USER'
    ) {
      return null;
    }
    const secondParticipant = participantMap.SECOND;
    if (!secondParticipant) {
      throw new SolitaireRuntimeRecoveryServiceError(
        'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
        '对墙打参与者数据不完整，无法恢复',
        409
      );
    }

    const currentPublicSeq = checkpoint.related_public_seq ?? 0;
    const publicEvents = await this.getRecoveredPublicEventTail(
      matchId,
      checkpoint.timeline_seq,
      currentPublicSeq
    );
    const retainedPublicEventFloorSeq = publicEvents.publicEvents[0]
      ? Math.max(0, publicEvents.publicEvents[0].seq - 1)
      : currentPublicSeq;
    const session = createGameSession({
      gameMode: record.automation_game_mode === 'SOLITAIRE' ? GameMode.SOLITAIRE : GameMode.DEBUG,
    });
    const privateSeqBySeat = readPrivateSeqBySeat(record.last_private_seq_by_seat);
    session.restoreRuntimeState({
      authorityState,
      currentPublicSeq,
      publicEvents: publicEvents.publicEvents,
      retainedPublicEventFloorSeq,
      currentPrivateSeq: Math.max(privateSeqBySeat.FIRST, privateSeqBySeat.SECOND),
      currentPrivateSeqBySeat: privateSeqBySeat,
      currentAuditSeq: record.last_audit_seq,
      currentCommandSeq: record.last_command_seq,
    });

    const runtimeDeckSnapshots = buildRuntimeDeckSnapshots(deckSnapshots, authorityState);
    const restoredAt = this.now();
    const recovery: RuntimeRecoveryInfo = {
      restoredAt,
      checkpointSeq: checkpoint.checkpoint_seq,
      checkpointTimelineSeq: checkpoint.timeline_seq,
      currentPublicSeq,
      rolledBackFromPublicSeq:
        record.last_public_seq > currentPublicSeq ? record.last_public_seq : null,
      rolledBackFromTimelineSeq:
        record.last_timeline_seq > checkpoint.timeline_seq ? record.last_timeline_seq : null,
    };

    return {
      match: {
        matchId: record.match_id,
        roomCode: record.room_code,
        matchMode: record.match_mode,
        automationGameMode: record.automation_game_mode,
        originKind: record.origin_kind,
        originLabel: record.origin_label,
        session,
        participants: participantMap,
        deckSnapshots: runtimeDeckSnapshots,
        startedAt: dateToMs(record.started_at),
        remoteRevision: computeRecoveredRemoteRevision(record, checkpoint),
        recordBranchId: `${record.match_id}:recovery:${checkpoint.checkpoint_seq}:timeline:${record.last_timeline_seq + 1}`,
        recordCaptureCursor: session.getRuntimeCaptureCursor(),
        pendingUndoRequest: null,
        activeUndoGrant: null,
        appliedUndoKeys: new Set<string>(),
        updatedAt: restoredAt,
        lastActivityAt: restoredAt,
        recoveryNotice: {
          ...recovery,
          publicEvents: publicEvents.publicEvents,
          truncated: publicEvents.truncated,
          droppedEventCount: publicEvents.droppedEventCount,
        },
      },
      recovery,
    };
  }

  private async getRecoveryRecord(
    matchId: string,
    userId: string
  ): Promise<RecoveryRecordRow | null> {
    const result = await this.queryClient.query<RecoveryRecordRow>(
      `SELECT
        record.match_id,
        record.room_code,
        record.match_mode,
        record.automation_game_mode,
        record.origin_kind,
        record.origin_label,
        record.status,
        record.started_at,
        record.updated_at,
        record.last_timeline_seq,
        record.last_checkpoint_seq,
        record.last_public_seq,
        record.last_private_seq_by_seat,
        record.last_audit_seq,
        record.last_command_seq,
        record.last_game_event_seq
      FROM match_records record
      INNER JOIN match_participants participant
        ON participant.match_id = record.match_id
        AND participant.seat = 'FIRST'
        AND participant.participant_kind = 'USER'
      WHERE record.match_id = $1
        AND record.match_mode = 'SOLITAIRE'
        AND participant.user_id = $2
      LIMIT 1`,
      [matchId, userId]
    );
    return result.rows[0] ?? null;
  }

  private async getParticipants(matchId: string): Promise<readonly ParticipantRow[]> {
    const result = await this.queryClient.query<ParticipantRow>(
      `SELECT seat, user_id, display_name, player_id, participant_kind, owner_user_id
      FROM match_participants
      WHERE match_id = $1
      ORDER BY seat`,
      [matchId]
    );
    return result.rows;
  }

  private async getDeckSnapshots(matchId: string): Promise<readonly DeckSnapshotRow[]> {
    const result = await this.queryClient.query<DeckSnapshotRow>(
      `SELECT
        seat,
        user_id,
        source_deck_id,
        source_deck_name,
        source,
        main_deck,
        energy_deck,
        locked_at
      FROM match_deck_snapshots
      WHERE match_id = $1
      ORDER BY seat`,
      [matchId]
    );
    return result.rows;
  }

  private async getLatestAuthorityCheckpoint(matchId: string): Promise<CheckpointRow | null> {
    const result = await this.queryClient.query<CheckpointRow>(
      `SELECT
        checkpoint_seq,
        timeline_seq,
        related_public_seq,
        related_command_seq,
        related_game_event_seq,
        payload,
        payload_compression
      FROM match_checkpoints
      WHERE match_id = $1
        AND checkpoint_type = 'AUTHORITY'
      ORDER BY checkpoint_seq DESC
      LIMIT 1`,
      [matchId]
    );
    return result.rows[0] ?? null;
  }

  private async getRecoveredPublicEventTail(
    matchId: string,
    checkpointTimelineSeq: number,
    currentPublicSeq: number
  ): Promise<{
    readonly publicEvents: readonly PublicEvent[];
    readonly truncated: boolean;
    readonly droppedEventCount: number;
  }> {
    if (currentPublicSeq <= 0 || this.publicEventTailLimit <= 0) {
      return {
        publicEvents: [],
        truncated: false,
        droppedEventCount: 0,
      };
    }

    const result = await this.queryClient.query<PublicEventRow>(
      `SELECT
        event.timeline_seq,
        event.event_seq,
        event.payload
      FROM match_record_public_events event
      WHERE event.match_id = $1
        AND event.timeline_seq <= $2
        AND event.event_seq <= $3
      ORDER BY event.timeline_seq DESC, event.event_seq DESC
      LIMIT $4`,
      [matchId, checkpointTimelineSeq, currentPublicSeq, this.publicEventTailLimit]
    );

    const publicEvents = [...result.rows]
      .reverse()
      .map((row) => row.payload as PublicEvent)
      .filter((event): event is PublicEvent => Boolean(event));
    const oldestSeq = publicEvents[0]?.seq ?? currentPublicSeq;
    const droppedEventCount = Math.max(0, oldestSeq - 1);
    return {
      publicEvents,
      truncated: droppedEventCount > 0,
      droppedEventCount,
    };
  }
}

export const solitaireRuntimeRecoveryService = new SolitaireRuntimeRecoveryService();

function buildParticipantMap(rows: readonly ParticipantRow[]): OnlineMatchState['participants'] {
  const first = rows.find((row) => row.seat === 'FIRST');
  const second = rows.find((row) => row.seat === 'SECOND');
  if (!first || !second) {
    throw new SolitaireRuntimeRecoveryServiceError(
      'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
      '对墙打参与者记录缺失，无法恢复',
      409
    );
  }

  return {
    FIRST: {
      userId: first.user_id,
      playerId: first.player_id,
      displayName: first.display_name,
      seat: 'FIRST',
      participantKind: first.participant_kind,
      ownerUserId: first.owner_user_id,
    },
    SECOND: {
      userId: second.user_id,
      playerId: second.player_id,
      displayName: second.display_name,
      seat: 'SECOND',
      participantKind: second.participant_kind,
      ownerUserId: second.owner_user_id,
    },
  };
}

function buildRuntimeDeckSnapshots(
  rows: readonly DeckSnapshotRow[],
  authorityState: GameState
): OnlineMatchState['deckSnapshots'] {
  const cardsByCode = groupCardDataByCode(authorityState);
  const first = rows.find((row) => row.seat === 'FIRST');
  const second = rows.find((row) => row.seat === 'SECOND');
  if (!first || !second) {
    throw new SolitaireRuntimeRecoveryServiceError(
      'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
      '对墙打卡组快照缺失，无法恢复',
      409
    );
  }

  return {
    FIRST: mapDeckSnapshotRow(first, cardsByCode),
    SECOND: mapDeckSnapshotRow(second, cardsByCode),
  };
}

function mapDeckSnapshotRow(
  row: DeckSnapshotRow,
  cardsByCode: ReadonlyMap<string, AnyCardData>
): OnlineMatchState['deckSnapshots']['FIRST'] {
  return {
    seat: row.seat,
    userId: row.user_id,
    sourceDeckId: row.source_deck_id,
    sourceDeckName: row.source_deck_name,
    source: row.source,
    mainDeck: readJsonArray<string>(row.main_deck).map((cardCode) =>
      resolveDeckCardData(cardsByCode, cardCode)
    ),
    energyDeck: readJsonArray<string>(row.energy_deck).map((cardCode) =>
      resolveDeckCardData(cardsByCode, cardCode)
    ),
    lockedAt: nullableDateToMs(row.locked_at),
  };
}

function resolveDeckCardData(
  cardsByCode: ReadonlyMap<string, AnyCardData>,
  cardCode: string
): AnyCardData {
  const cardData = cardsByCode.get(cardCode);
  if (!cardData) {
    throw new SolitaireRuntimeRecoveryServiceError(
      'SOLITAIRE_MATCH_RECOVERY_CARD_DATA_MISSING',
      `对墙打缺少 ${cardCode} 的卡牌数据，无法恢复`,
      409
    );
  }
  return cardData;
}

function groupCardDataByCode(authorityState: GameState): ReadonlyMap<string, AnyCardData> {
  const byCode = new Map<string, AnyCardData>();
  for (const card of authorityState.cardRegistry.values()) {
    const data = readCardData(card);
    if (data && !byCode.has(data.cardCode)) {
      byCode.set(data.cardCode, data);
    }
  }
  return byCode;
}

function readCardData(card: CardInstance): AnyCardData | null {
  return card.data.cardType === 'MEMBER' ||
    card.data.cardType === 'LIVE' ||
    card.data.cardType === 'ENERGY'
    ? (card.data as AnyCardData)
    : null;
}

function computeRecoveredRemoteRevision(
  record: RecoveryRecordRow,
  checkpoint: CheckpointRow
): number {
  return (
    Math.max(
      0,
      record.last_timeline_seq,
      record.last_checkpoint_seq,
      record.last_public_seq,
      record.last_audit_seq,
      record.last_command_seq,
      record.last_game_event_seq,
      checkpoint.related_public_seq ?? 0,
      checkpoint.related_command_seq ?? 0,
      checkpoint.related_game_event_seq ?? 0
    ) + 1
  );
}

function readPrivateSeqBySeat(value: unknown): Readonly<Record<Seat, number>> {
  if (!value || typeof value !== 'object') {
    return { FIRST: 0, SECOND: 0 };
  }
  const source = value as Record<string, unknown>;
  return {
    FIRST: readNonNegativeInt(source.FIRST),
    SECOND: readNonNegativeInt(source.SECOND),
  };
}

function readJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? [...value] : [];
}

function readNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function dateToMs(value: Date | string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function nullableDateToMs(value: Date | string | number | null): number | null {
  return value === null ? null : dateToMs(value);
}
