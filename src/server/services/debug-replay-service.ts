import { createHash, randomUUID } from 'node:crypto';
import type { AnyCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { GamePhase } from '../../shared/types/enums.js';
import { projectPlayerViewState } from '../../online/projector.js';
import type {
  DebugReplayBundle,
  DebugReplayCardSummary,
  DebugReplayCheckpointInfo,
  DebugReplayCheckpointView,
  DebugReplayDeckSnapshot,
  DebugReplayImportSummary,
  DebugReplayParticipant,
  DebugReplayTimelineView,
  ReplayCapability,
  ReplayLimitation,
  ReplayRecordFrame,
  ReplayRecordFrameType,
  ReplayVisibilityScope,
} from '../../online/replay-types.js';
import type {
  MatchCommandRecord,
  PrivateEvent,
  PublicEvent,
  SealedAuditRecord,
  Seat,
} from '../../online/types.js';
import type { OnlineMatchDeckSnapshot, OnlineMatchState } from './online-match-service.js';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
  stableJsonStringify,
  toReplayJsonValue,
  validateReplayPayloadEnvelope,
} from './replay-payload-serialization.js';
import {
  DEBUG_REPLAY_BUNDLE_SCHEMA_VERSION,
  GAME_STATE_SCHEMA_VERSION,
  REPLAY_CARD_DATA_VERSION,
  REPLAY_RECORD_SCHEMA_VERSION,
  REPLAY_RULES_VERSION,
} from './replay-constants.js';

const DEBUG_REPLAY_IMPORT_TTL_MS = 60 * 60 * 1000;

interface ReplayFrameDraft {
  readonly frameType: ReplayRecordFrameType;
  readonly visibilityScope: ReplayVisibilityScope;
  readonly relatedCheckpointSeq: number | null;
  readonly relatedPublicSeq: number | null;
  readonly relatedPrivateSeq: number | null;
  readonly relatedAuditSeq: number | null;
  readonly relatedCommandSeq: number | null;
  readonly relatedGameEventSeq: number | null;
  readonly relatedDecisionId: string | null;
  readonly dedupeKey: string;
  readonly summary: string;
  readonly createdAt: number;
  readonly sortOrder: number;
  readonly turnCount?: number;
  readonly phase?: GamePhase | string;
  readonly subPhase?: string;
}

interface ImportedDebugReplayBundle {
  readonly bundleId: string;
  readonly bundle: DebugReplayBundle;
  readonly importedAt: number;
  readonly expiresAt: number;
}

export class DebugReplayServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'DebugReplayServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class DebugReplayService {
  private readonly importedBundles = new Map<string, ImportedDebugReplayBundle>();
  private readonly now: () => number;

  constructor(deps: { readonly now?: () => number } = {}) {
    this.now = deps.now ?? (() => Date.now());
  }

  importBundle(bundleInput: unknown): DebugReplayImportSummary {
    this.cleanupExpired();

    const bundle = validateDebugReplayBundle(bundleInput);
    const importedAt = this.now();
    const imported: ImportedDebugReplayBundle = {
      bundleId: randomUUID(),
      bundle,
      importedAt,
      expiresAt: importedAt + DEBUG_REPLAY_IMPORT_TTL_MS,
    };
    this.importedBundles.set(imported.bundleId, imported);

    return buildImportSummary(imported);
  }

  getTimeline(bundleId: string): DebugReplayTimelineView {
    const imported = this.getImportedBundle(bundleId);
    return {
      bundleId: imported.bundleId,
      importedAt: imported.importedAt,
      expiresAt: imported.expiresAt,
      sourceMatch: imported.bundle.sourceMatch,
      capabilities: imported.bundle.capabilities,
      limitations: imported.bundle.limitations,
      timelineSummary: imported.bundle.timelineSummary,
      recordFrames: imported.bundle.recordFrames,
    };
  }

  getCheckpointView(
    bundleId: string,
    checkpointSeq: number,
    viewerSeat: Seat
  ): DebugReplayCheckpointView {
    const imported = this.getImportedBundle(bundleId);
    const checkpoint = imported.bundle.checkpoints.find(
      (candidate) => candidate.checkpointSeq === checkpointSeq
    );
    if (!checkpoint) {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_CHECKPOINT_NOT_FOUND',
        '调试回放检查点不存在',
        404
      );
    }
    if (checkpoint.checkpointType !== 'AUTHORITY') {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_CHECKPOINT_UNSUPPORTED',
        '当前版本只支持读取 authority checkpoint 的投影视图',
        409
      );
    }

    const participant = imported.bundle.participants.find(
      (candidate) => candidate.seat === viewerSeat
    );
    if (!participant) {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_VIEWER_SEAT_INVALID',
        '调试回放中不存在该视角座位',
        400
      );
    }

    const authorityState = rehydrateAuthorityGameState(checkpoint.payloadEnvelope);
    const playerViewState = projectPlayerViewState(authorityState, participant.playerId, {
      seq: checkpoint.relatedPublicSeq ?? imported.bundle.sourceMatch.currentPublicSeq,
    });

    return {
      bundleId: imported.bundleId,
      viewerSeat,
      checkpointInfo: toCheckpointInfo(checkpoint),
      recordFrame:
        imported.bundle.recordFrames.find(
          (frame) => frame.timelineSeq === checkpoint.timelineSeq
        ) ?? null,
      playerViewState,
      sourceMatch: imported.bundle.sourceMatch,
      capabilities: imported.bundle.capabilities,
      limitations: imported.bundle.limitations,
    };
  }

  clear(): void {
    this.importedBundles.clear();
  }

  private getImportedBundle(bundleId: string): ImportedDebugReplayBundle {
    this.cleanupExpired();
    const imported = this.importedBundles.get(bundleId);
    if (!imported) {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_BUNDLE_NOT_FOUND',
        '调试回放包不存在或已过期',
        404
      );
    }
    return imported;
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [bundleId, imported] of this.importedBundles) {
      if (imported.expiresAt <= now) {
        this.importedBundles.delete(bundleId);
      }
    }
  }
}

export const debugReplayService = new DebugReplayService();

export function createDebugReplayBundle(
  match: OnlineMatchState,
  now = Date.now()
): DebugReplayBundle {
  const authorityState = match.session.getAuthoritySnapshotForRecord();
  if (!authorityState) {
    throw new Error('对局权威状态不存在，无法导出调试回放包');
  }

  const publicEvents = match.session.getPublicEventsSince(0);
  const privateEventsBySeat = collectPrivateEventsBySeat(match);
  const sealedAudit = match.session.getSealedAuditSince(0);
  const commands = match.session.getCommandLogSince(0);
  const gameEvents = match.session.getGameEventsSince(0);
  const cardDataHash = hashJsonValue(buildRuntimeCardDataHashInput(match.deckSnapshots));
  const checkpointSeq = 1;
  const capabilities: readonly ReplayCapability[] = [
    'AUTHORITY_CHECKPOINT',
    'PUBLIC_EVENTS',
    'PRIVATE_EVENTS',
    'SEALED_AUDIT',
    'COMMAND_LOG',
    'GAME_EVENTS_SNAPSHOT',
  ];
  const limitations: readonly ReplayLimitation[] = [
    'SINGLE_CHECKPOINT_ONLY',
    'LIMITED_TIMELINE',
    'NO_DETERMINISTIC_REPLAY',
    'NOT_USER_HISTORY_RECORD',
    'GAME_EVENTS_SNAPSHOT',
    'DECISION_RECORDS_UNAVAILABLE',
    'DECK_SNAPSHOT_FROM_RUNTIME_STATE',
  ];

  const frameDrafts = buildFrameDrafts({
    publicEvents,
    privateEventsBySeat,
    sealedAudit,
    commands,
    gameEvents,
  });
  const checkpointTimelineSeq = frameDrafts.length + 1;
  const recordFrames = materializeRecordFrames(match, authorityState, [
    ...frameDrafts,
    {
      frameType: 'CHECKPOINT_WRITTEN',
      visibilityScope: 'ADMIN',
      relatedCheckpointSeq: checkpointSeq,
      relatedPublicSeq: match.session.getCurrentPublicEventSeq(),
      relatedPrivateSeq: null,
      relatedAuditSeq: null,
      relatedCommandSeq: commands.at(-1)?.seq ?? null,
      relatedGameEventSeq: match.session.getCurrentGameEventSeq() || null,
      relatedDecisionId: null,
      dedupeKey: `checkpoint:${checkpointSeq}`,
      summary: '导出当前权威检查点',
      createdAt: now,
      sortOrder: Number.MAX_SAFE_INTEGER,
      turnCount: authorityState.turnCount,
      phase: authorityState.currentPhase,
      subPhase: authorityState.currentSubPhase,
    },
  ]);

  const checkpoint = {
    matchId: match.matchId,
    checkpointSeq,
    timelineSeq: checkpointTimelineSeq,
    checkpointType: 'AUTHORITY' as const,
    relatedPublicSeq: match.session.getCurrentPublicEventSeq(),
    relatedCommandSeq: commands.at(-1)?.seq ?? null,
    relatedGameEventSeq: match.session.getCurrentGameEventSeq() || null,
    turnCount: authorityState.turnCount,
    phase: authorityState.currentPhase,
    subPhase: authorityState.currentSubPhase,
    createdAt: now,
    payloadEnvelope: serializeReplayPayload(
      authorityState,
      'AUTHORITY_GAME_STATE',
      GAME_STATE_SCHEMA_VERSION
    ),
    visibilityScope: 'ADMIN' as const,
    capabilities,
    limitations,
  };

  return {
    recordSchemaVersion: REPLAY_RECORD_SCHEMA_VERSION,
    bundleSchemaVersion: DEBUG_REPLAY_BUNDLE_SCHEMA_VERSION,
    serializer: 'TRANSPORT_V1',
    exportedAt: now,
    appVersion: process.env.npm_package_version ?? 'unknown',
    gitCommit: process.env.GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    rulesVersion: REPLAY_RULES_VERSION,
    cardDataVersion: REPLAY_CARD_DATA_VERSION,
    cardDataHash,
    sourceMatch: {
      matchId: match.matchId,
      roomCode: match.roomCode,
      exportedStatus: 'RUNNING_OR_RECENT',
      startedAt: match.startedAt,
      updatedAt: match.updatedAt,
      lastActivityAt: match.lastActivityAt,
      currentPublicSeq: match.session.getCurrentPublicEventSeq(),
      currentGameEventSeq: match.session.getCurrentGameEventSeq(),
      turnCount: authorityState.turnCount,
      phase: authorityState.currentPhase,
      subPhase: authorityState.currentSubPhase,
      complete: authorityState.currentPhase === GamePhase.GAME_END,
    },
    participants: buildParticipants(match),
    deckSnapshots: buildDeckSnapshots(match.deckSnapshots, cardDataHash),
    recordFrames,
    checkpoints: [checkpoint],
    timelineSummary: recordFrames.map((frame) => ({
      timelineSeq: frame.timelineSeq,
      frameType: frame.frameType,
      summary: frame.summary,
      createdAt: frame.createdAt,
    })),
    commands: toReplayJsonValue(commands) as readonly unknown[],
    publicEvents: toReplayJsonValue(publicEvents) as readonly unknown[],
    privateEventsBySeat: {
      FIRST: toReplayJsonValue(privateEventsBySeat.FIRST) as readonly unknown[],
      SECOND: toReplayJsonValue(privateEventsBySeat.SECOND) as readonly unknown[],
    },
    sealedAudit: toReplayJsonValue(sealedAudit) as readonly unknown[],
    gameEvents: toReplayJsonValue(gameEvents) as readonly unknown[],
    decisions: [],
    capabilities,
    limitations,
  };
}

function collectPrivateEventsBySeat(
  match: OnlineMatchState
): Readonly<Record<Seat, readonly PrivateEvent[]>> {
  return {
    FIRST: match.session.getPrivateEventsSince(match.participants.FIRST.playerId, 0),
    SECOND: match.session.getPrivateEventsSince(match.participants.SECOND.playerId, 0),
  };
}

function buildParticipants(match: OnlineMatchState): readonly DebugReplayParticipant[] {
  return (['FIRST', 'SECOND'] as const).map((seat) => ({
    seat,
    userId: match.participants[seat].userId,
    displayName: match.participants[seat].displayName,
    playerId: match.participants[seat].playerId,
  }));
}

function buildDeckSnapshots(
  snapshots: Readonly<Record<Seat, OnlineMatchDeckSnapshot>>,
  cardDataHash: string
): readonly DebugReplayDeckSnapshot[] {
  return (['FIRST', 'SECOND'] as const).map((seat) => {
    const snapshot = snapshots[seat];
    return {
      seat,
      sourceDeckId: snapshot.sourceDeckId,
      sourceDeckName: snapshot.sourceDeckName,
      source: 'ONLINE_RUNTIME_DECK',
      mainDeck: snapshot.mainDeck.map((card) => card.cardCode),
      energyDeck: snapshot.energyDeck.map((card) => card.cardCode),
      cardSummaries: buildCardSummaries([...snapshot.mainDeck, ...snapshot.energyDeck]),
      validationState: 'RUNTIME_ACCEPTED',
      cardDataVersion: REPLAY_CARD_DATA_VERSION,
      cardDataHash,
      lockedAt: snapshot.lockedAt,
    };
  });
}

function buildCardSummaries(
  cards: readonly AnyCardData[]
): Readonly<Record<string, DebugReplayCardSummary>> {
  const summaries: Record<string, DebugReplayCardSummary> = {};
  for (const card of cards) {
    summaries[card.cardCode] = {
      cardCode: card.cardCode,
      name: card.name,
      cardType: card.cardType,
      ...('cost' in card ? { cost: card.cost } : {}),
      ...('score' in card ? { score: card.score } : {}),
    };
  }
  return summaries;
}

function buildRuntimeCardDataHashInput(
  snapshots: Readonly<Record<Seat, OnlineMatchDeckSnapshot>>
): readonly unknown[] {
  return (['FIRST', 'SECOND'] as const).flatMap((seat) =>
    [...snapshots[seat].mainDeck, ...snapshots[seat].energyDeck].map((card) =>
      buildCardDataHashEntry(seat, card.cardCode, card)
    )
  );
}

function buildBundleCardDataHashInput(
  deckSnapshots: readonly DebugReplayDeckSnapshot[],
  authorityState: GameState
): readonly unknown[] {
  const cardDataByCode = new Map<string, AnyCardData>();
  for (const card of authorityState.cardRegistry.values()) {
    if (!cardDataByCode.has(card.data.cardCode)) {
      cardDataByCode.set(card.data.cardCode, card.data as AnyCardData);
    }
  }

  return (['FIRST', 'SECOND'] as const).flatMap((seat) => {
    const snapshot = deckSnapshots.find((candidate) => candidate.seat === seat);
    if (!snapshot) {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_INVALID_BUNDLE',
        `调试回放缺少 ${seat} 卡组快照`
      );
    }

    return [...snapshot.mainDeck, ...snapshot.energyDeck].map((cardCode) => {
      const cardData = cardDataByCode.get(cardCode);
      if (!cardData) {
        throw new DebugReplayServiceError(
          'DEBUG_REPLAY_INVALID_CARD_DATA',
          `调试回放卡组快照引用了不存在的卡牌: ${cardCode}`
        );
      }

      return buildCardDataHashEntry(seat, cardCode, cardData);
    });
  });
}

function buildCardDataHashEntry(seat: Seat, cardCode: string, cardData: AnyCardData): unknown {
  return {
    seat,
    cardCode,
    data: toReplayJsonValue(cardData),
  };
}

function buildFrameDrafts(facts: {
  readonly publicEvents: readonly PublicEvent[];
  readonly privateEventsBySeat: Readonly<Record<Seat, readonly PrivateEvent[]>>;
  readonly sealedAudit: readonly SealedAuditRecord[];
  readonly commands: readonly MatchCommandRecord[];
  readonly gameEvents: readonly {
    readonly sequence: number;
    readonly event: { readonly eventType: string; readonly timestamp: number };
  }[];
}): readonly ReplayFrameDraft[] {
  const drafts: ReplayFrameDraft[] = [];

  for (const event of facts.publicEvents) {
    drafts.push({
      frameType: 'PUBLIC_EVENT',
      visibilityScope: 'PUBLIC',
      relatedCheckpointSeq: null,
      relatedPublicSeq: event.seq,
      relatedPrivateSeq: null,
      relatedAuditSeq: null,
      relatedCommandSeq: null,
      relatedGameEventSeq: null,
      relatedDecisionId: null,
      dedupeKey: `public:${event.seq}`,
      summary: `公共事件：${event.type}`,
      createdAt: event.timestamp,
      sortOrder: 20,
    });
  }

  for (const seat of ['FIRST', 'SECOND'] as const) {
    for (const event of facts.privateEventsBySeat[seat]) {
      drafts.push({
        frameType: 'PRIVATE_EVENT',
        visibilityScope: 'PRIVATE',
        relatedCheckpointSeq: null,
        relatedPublicSeq: event.relatedPublicSeq,
        relatedPrivateSeq: event.seq,
        relatedAuditSeq: null,
        relatedCommandSeq: null,
        relatedGameEventSeq: null,
        relatedDecisionId: null,
        dedupeKey: `private:${seat}:${event.seq}`,
        summary: `${seat} 私密事件：${event.type}`,
        createdAt: event.timestamp,
        sortOrder: 30,
      });
    }
  }

  for (const record of facts.sealedAudit) {
    drafts.push({
      frameType: 'SEALED_AUDIT',
      visibilityScope: 'ADMIN',
      relatedCheckpointSeq: null,
      relatedPublicSeq: record.relatedPublicSeq,
      relatedPrivateSeq: null,
      relatedAuditSeq: record.seq,
      relatedCommandSeq: null,
      relatedGameEventSeq: null,
      relatedDecisionId: null,
      dedupeKey: `audit:${record.seq}`,
      summary: `密封审计：${record.type}`,
      createdAt: record.timestamp,
      sortOrder: 40,
    });
  }

  for (const command of facts.commands) {
    drafts.push({
      frameType: command.status === 'ACCEPTED' ? 'COMMAND_ACCEPTED' : 'COMMAND_REJECTED',
      visibilityScope: 'ADMIN',
      relatedCheckpointSeq: null,
      relatedPublicSeq: command.resultingPublicSeq,
      relatedPrivateSeq: null,
      relatedAuditSeq: null,
      relatedCommandSeq: command.seq,
      relatedGameEventSeq: null,
      relatedDecisionId: null,
      dedupeKey: `command:${command.seq}`,
      summary: `${command.status === 'ACCEPTED' ? '接受命令' : '拒绝命令'}：${command.commandType}`,
      createdAt: command.timestamp,
      sortOrder: 10,
    });
  }

  for (const entry of facts.gameEvents) {
    drafts.push({
      frameType: 'GAME_EVENT',
      visibilityScope: 'ADMIN',
      relatedCheckpointSeq: null,
      relatedPublicSeq: null,
      relatedPrivateSeq: null,
      relatedAuditSeq: null,
      relatedCommandSeq: null,
      relatedGameEventSeq: entry.sequence,
      relatedDecisionId: null,
      dedupeKey: `game-event:${entry.sequence}`,
      summary: `规则事件：${entry.event.eventType}`,
      createdAt: entry.event.timestamp,
      sortOrder: 50,
    });
  }

  return drafts.sort(
    (left, right) =>
      left.createdAt - right.createdAt ||
      left.sortOrder - right.sortOrder ||
      left.dedupeKey.localeCompare(right.dedupeKey)
  );
}

function materializeRecordFrames(
  match: OnlineMatchState,
  currentState: GameState,
  drafts: readonly ReplayFrameDraft[]
): readonly ReplayRecordFrame[] {
  return drafts.map((draft, index) => {
    const frameState = resolveReplayFrameState(match, currentState, draft);

    return {
      matchId: match.matchId,
      timelineSeq: index + 1,
      frameType: draft.frameType,
      visibilityScope: draft.visibilityScope,
      relatedCheckpointSeq: draft.relatedCheckpointSeq,
      relatedPublicSeq: draft.relatedPublicSeq,
      relatedPrivateSeq: draft.relatedPrivateSeq,
      relatedAuditSeq: draft.relatedAuditSeq,
      relatedCommandSeq: draft.relatedCommandSeq,
      relatedGameEventSeq: draft.relatedGameEventSeq,
      relatedDecisionId: draft.relatedDecisionId,
      dedupeKey: draft.dedupeKey,
      turnCount: frameState.turnCount,
      phase: frameState.phase,
      subPhase: frameState.subPhase,
      summary: draft.summary,
      createdAt: draft.createdAt,
    };
  });
}

function resolveReplayFrameState(
  match: OnlineMatchState,
  currentState: GameState,
  draft: ReplayFrameDraft
): Pick<ReplayRecordFrame, 'turnCount' | 'phase' | 'subPhase'> {
  if (draft.turnCount !== undefined && draft.phase !== undefined && draft.subPhase !== undefined) {
    return {
      turnCount: draft.turnCount,
      phase: draft.phase,
      subPhase: draft.subPhase,
    };
  }

  if (draft.relatedPublicSeq !== null) {
    const snapshot = match.session.getAuthoritySnapshotAtOrBefore(draft.relatedPublicSeq);
    if (snapshot) {
      return {
        turnCount: snapshot.turnCount,
        phase: snapshot.currentPhase,
        subPhase: snapshot.currentSubPhase,
      };
    }
  }

  if (draft.relatedCheckpointSeq !== null) {
    return {
      turnCount: currentState.turnCount,
      phase: currentState.currentPhase,
      subPhase: currentState.currentSubPhase,
    };
  }

  return {
    turnCount: 0,
    phase: 'UNKNOWN',
    subPhase: 'UNKNOWN',
  };
}

function hashJsonValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`;
}

function validateDebugReplayBundle(bundleInput: unknown): DebugReplayBundle {
  if (!isRecord(bundleInput)) {
    throw new DebugReplayServiceError('DEBUG_REPLAY_INVALID_BUNDLE', '调试回放包格式非法');
  }

  if (bundleInput.recordSchemaVersion !== REPLAY_RECORD_SCHEMA_VERSION) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_UNSUPPORTED_RECORD_SCHEMA',
      '不支持的调试回放 record schema version'
    );
  }
  if (bundleInput.bundleSchemaVersion !== DEBUG_REPLAY_BUNDLE_SCHEMA_VERSION) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_UNSUPPORTED_BUNDLE_SCHEMA',
      '不支持的调试回放 bundle schema version'
    );
  }
  if (bundleInput.serializer !== 'TRANSPORT_V1') {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_UNSUPPORTED_SERIALIZER',
      '不支持的调试回放 serializer'
    );
  }
  if (!isRecord(bundleInput.sourceMatch)) {
    throw new DebugReplayServiceError('DEBUG_REPLAY_INVALID_BUNDLE', '调试回放来源对局缺失');
  }
  if (
    !Array.isArray(bundleInput.participants) ||
    !Array.isArray(bundleInput.deckSnapshots) ||
    !Array.isArray(bundleInput.checkpoints) ||
    !Array.isArray(bundleInput.recordFrames) ||
    !Array.isArray(bundleInput.timelineSummary) ||
    !Array.isArray(bundleInput.capabilities) ||
    !Array.isArray(bundleInput.limitations)
  ) {
    throw new DebugReplayServiceError('DEBUG_REPLAY_INVALID_BUNDLE', '调试回放包列表字段非法');
  }

  const bundle = JSON.parse(JSON.stringify(toReplayJsonValue(bundleInput))) as DebugReplayBundle;
  validateBundleCompatibility(bundle);
  const participantSeats = new Set(bundle.participants.map((participant) => participant.seat));
  if (!participantSeats.has('FIRST') || !participantSeats.has('SECOND')) {
    throw new DebugReplayServiceError('DEBUG_REPLAY_INVALID_BUNDLE', '调试回放参与者座位不完整');
  }
  if (
    bundle.sourceMatch.exportedStatus !== 'HISTORY_RECORD' &&
    !bundle.limitations.includes('NOT_USER_HISTORY_RECORD')
  ) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_INVALID_BUNDLE',
      'E0 调试回放包必须标记 NOT_USER_HISTORY_RECORD'
    );
  }
  if (bundle.checkpoints.length === 0) {
    throw new DebugReplayServiceError('DEBUG_REPLAY_INVALID_BUNDLE', '调试回放包没有检查点');
  }

  let firstAuthorityState: GameState | null = null;
  for (const checkpoint of bundle.checkpoints) {
    if (checkpoint.checkpointType !== 'AUTHORITY') {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_CHECKPOINT_UNSUPPORTED',
        '当前版本只支持导入 authority checkpoint',
        409
      );
    }
    validateReplayPayloadEnvelope(checkpoint.payloadEnvelope, 'AUTHORITY_GAME_STATE');
    const authorityState = rehydrateAuthorityGameState(checkpoint.payloadEnvelope);
    firstAuthorityState ??= authorityState;
    validateCheckpointMatchesAuthorityState(bundle, checkpoint, authorityState);
  }

  if (!firstAuthorityState) {
    throw new DebugReplayServiceError('DEBUG_REPLAY_INVALID_BUNDLE', '调试回放包没有可用权威状态');
  }
  validateDeckSnapshots(bundle, firstAuthorityState);

  return bundle;
}

function validateBundleCompatibility(bundle: DebugReplayBundle): void {
  if (bundle.rulesVersion !== REPLAY_RULES_VERSION) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_INCOMPATIBLE_RULES_VERSION',
      '调试回放规则版本不兼容'
    );
  }
  if (bundle.cardDataVersion !== REPLAY_CARD_DATA_VERSION) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_INCOMPATIBLE_CARD_DATA_VERSION',
      '调试回放卡牌数据版本不兼容'
    );
  }

  const currentAppVersion = process.env.npm_package_version ?? 'unknown';
  if (
    currentAppVersion !== 'unknown' &&
    bundle.appVersion !== 'unknown' &&
    bundle.appVersion !== currentAppVersion
  ) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_INCOMPATIBLE_APP_VERSION',
      '调试回放应用版本不兼容'
    );
  }

  const currentGitCommit = process.env.GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  if (currentGitCommit && bundle.gitCommit && bundle.gitCommit !== currentGitCommit) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_INCOMPATIBLE_GIT_COMMIT',
      '调试回放代码版本不兼容'
    );
  }
}

function validateCheckpointMatchesAuthorityState(
  bundle: DebugReplayBundle,
  checkpoint: DebugReplayBundle['checkpoints'][number],
  authorityState: GameState
): void {
  if (
    checkpoint.matchId !== bundle.sourceMatch.matchId ||
    checkpoint.matchId !== authorityState.gameId
  ) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_CHECKPOINT_MISMATCH',
      '调试回放检查点 matchId 与权威状态不一致'
    );
  }
  if (
    checkpoint.turnCount !== authorityState.turnCount ||
    checkpoint.phase !== authorityState.currentPhase ||
    checkpoint.subPhase !== authorityState.currentSubPhase
  ) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_CHECKPOINT_MISMATCH',
      '调试回放检查点阶段信息与权威状态不一致'
    );
  }
}

function validateDeckSnapshots(bundle: DebugReplayBundle, authorityState: GameState): void {
  const deckSnapshotSeats = new Set(bundle.deckSnapshots.map((snapshot) => snapshot.seat));
  if (!deckSnapshotSeats.has('FIRST') || !deckSnapshotSeats.has('SECOND')) {
    throw new DebugReplayServiceError('DEBUG_REPLAY_INVALID_BUNDLE', '调试回放卡组快照座位不完整');
  }

  for (const snapshot of bundle.deckSnapshots) {
    if (snapshot.cardDataVersion !== bundle.cardDataVersion) {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_INCOMPATIBLE_CARD_DATA_VERSION',
        '调试回放卡组快照卡牌数据版本不一致'
      );
    }
    if (snapshot.cardDataHash !== bundle.cardDataHash) {
      throw new DebugReplayServiceError(
        'DEBUG_REPLAY_INCOMPATIBLE_CARD_DATA_HASH',
        '调试回放卡组快照卡牌数据 hash 不一致'
      );
    }
  }

  const expectedHash = hashJsonValue(
    buildBundleCardDataHashInput(bundle.deckSnapshots, authorityState)
  );
  if (bundle.cardDataHash !== expectedHash) {
    throw new DebugReplayServiceError(
      'DEBUG_REPLAY_INCOMPATIBLE_CARD_DATA_HASH',
      '调试回放卡牌数据 hash 校验失败'
    );
  }
}

function buildImportSummary(imported: ImportedDebugReplayBundle): DebugReplayImportSummary {
  return {
    bundleId: imported.bundleId,
    importedAt: imported.importedAt,
    expiresAt: imported.expiresAt,
    sourceMatch: imported.bundle.sourceMatch,
    capabilities: imported.bundle.capabilities,
    limitations: imported.bundle.limitations,
    checkpointCount: imported.bundle.checkpoints.length,
    timelineFrameCount: imported.bundle.recordFrames.length,
  };
}

function toCheckpointInfo(
  checkpoint: DebugReplayBundle['checkpoints'][number]
): DebugReplayCheckpointInfo {
  return {
    matchId: checkpoint.matchId,
    checkpointSeq: checkpoint.checkpointSeq,
    timelineSeq: checkpoint.timelineSeq,
    checkpointType: checkpoint.checkpointType,
    relatedPublicSeq: checkpoint.relatedPublicSeq,
    relatedCommandSeq: checkpoint.relatedCommandSeq,
    relatedGameEventSeq: checkpoint.relatedGameEventSeq,
    turnCount: checkpoint.turnCount,
    phase: checkpoint.phase,
    subPhase: checkpoint.subPhase,
    createdAt: checkpoint.createdAt,
    visibilityScope: checkpoint.visibilityScope,
    capabilities: checkpoint.capabilities,
    limitations: checkpoint.limitations,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
