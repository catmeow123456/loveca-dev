import type { GamePhase, SubPhase } from '../shared/types/enums.js';
import type { PlayerViewState, Seat } from './types.js';

export type ReplaySerializer = 'TRANSPORT_V1';

export type ReplayPayloadKind =
  | 'AUTHORITY_GAME_STATE'
  | 'PLAYER_VIEW_STATE'
  | 'PUBLIC_VIEW_STATE'
  | 'COMMAND_PAYLOAD'
  | 'EVENT_PAYLOAD';

export type ReplayCompression = 'NONE' | 'GZIP';

export type ReplayEncoding = 'JSON_VALUE' | 'BASE64_JSON';

export type ReplayCheckpointType = 'AUTHORITY' | 'PLAYER_VIEW' | 'PUBLIC_VIEW';

export type ReplayVisibilityScope = 'PUBLIC' | 'PRIVATE' | 'ADMIN' | 'SYSTEM';

export type MatchRecordStatus =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SURRENDERED'
  | 'INTERRUPTED'
  | 'CORRUPTED';

export type MatchRecordCompleteness = 'FULL' | 'PARTIAL' | 'INCOMPLETE';

export type MatchRecordReplayAccess = 'PARTICIPANT' | 'ADMIN';

export type MatchMode = 'ONLINE' | 'SOLITAIRE';

export type MatchAutomationGameMode = 'DEBUG' | 'SOLITAIRE';

export type MatchOriginKind = 'ONLINE_ROOM' | 'SOLITAIRE';

export type MatchParticipantKind = 'USER' | 'SYSTEM';

export type MatchDeckSnapshotSource =
  | 'ONLINE_RUNTIME_DECK'
  | 'PUBLISHED_CARDS_SNAPSHOT'
  | 'SOLITAIRE_DEFAULT_DECK';

export type MatchDeckSnapshotValidationState = 'RUNTIME_ACCEPTED' | 'VALID' | 'INVALID';

export type ReplayCapability =
  | 'AUTHORITY_CHECKPOINT'
  | 'PUBLIC_EVENTS'
  | 'PRIVATE_EVENTS'
  | 'SEALED_AUDIT'
  | 'COMMAND_LOG'
  | 'GAME_EVENTS_SNAPSHOT'
  | 'DECISION_RECORDS_PARTIAL';

export type ReplayLimitation =
  | 'SINGLE_CHECKPOINT_ONLY'
  | 'LIMITED_TIMELINE'
  | 'NO_DETERMINISTIC_REPLAY'
  | 'NOT_USER_HISTORY_RECORD'
  | 'GAME_EVENTS_SNAPSHOT'
  | 'DECISION_RECORDS_UNAVAILABLE'
  | 'DECK_SNAPSHOT_FROM_RUNTIME_STATE'
  | 'SOLITAIRE_AUTOMATION_COMPRESSED';

export type MatchDecisionType =
  | 'ACTIVE_EFFECT_OPENED'
  | 'ACTIVE_EFFECT_SUBMITTED'
  | 'PENDING_ABILITY_ORDER_SUBMITTED'
  | 'ACTIVATE_ABILITY_SUBMITTED'
  | 'MULLIGAN_SUBMITTED'
  | 'SET_LIVE_CARD_SUBMITTED'
  | 'SELECT_SUCCESS_LIVE_SUBMITTED';

export type MatchDecisionRecordStatus = 'OPENED' | 'SUBMITTED';

export type MatchDecisionTransitionSemantics =
  | 'STRUCTURED'
  | 'SNAPSHOT_AUDIT_ONLY'
  | 'UNSTRUCTURED_MANUAL';

export interface MatchDecisionCardSummary {
  readonly cardId: string;
  readonly cardCode: string | null;
  readonly baseCardCode: string | null;
  readonly name: string | null;
}

export interface MatchDecisionVisibleContextSummary {
  readonly selectableCardCount?: number;
  readonly selectableSlotCount?: number;
  readonly selectableOptionCount?: number;
  readonly hasPrivateCandidates?: boolean;
}

export interface MatchDecisionSubmissionSummary {
  readonly commandType?: string;
  readonly selectedCardId?: string | null;
  readonly selectedCardIds?: readonly string[];
  readonly selectedSlot?: string | null;
  readonly selectedOptionId?: string | null;
  readonly selectedPendingAbilityId?: string | null;
  readonly resolveInOrder?: boolean;
  readonly skipped?: boolean;
  readonly faceDown?: boolean;
}

export interface ReplaySerializedPayloadEnvelope {
  readonly payloadSchemaVersion: 1;
  readonly serializer: ReplaySerializer;
  readonly payloadKind: ReplayPayloadKind;
  readonly sourceSchemaVersion: string;
  readonly compressed: boolean;
  readonly compression: ReplayCompression;
  readonly encoding: ReplayEncoding;
  readonly payloadHash: string;
  readonly uncompressedByteLength: number;
  readonly compressedByteLength: number;
  readonly payload: unknown;
}

export interface ReplayCheckpointEnvelope {
  readonly matchId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly checkpointType: ReplayCheckpointType;
  readonly relatedPublicSeq: number | null;
  readonly relatedCommandSeq: number | null;
  readonly relatedGameEventSeq: number | null;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
  readonly createdAt: number;
  readonly payloadEnvelope: ReplaySerializedPayloadEnvelope;
  readonly visibilityScope: ReplayVisibilityScope;
  readonly capabilities: readonly ReplayCapability[];
  readonly limitations: readonly ReplayLimitation[];
}

export type ReplayRecordFrameType =
  | 'MATCH_INITIALIZED'
  | 'COMMAND_ACCEPTED'
  | 'COMMAND_REJECTED'
  | 'SYSTEM_TRANSITION'
  | 'UNDO_REQUESTED'
  | 'UNDO_ACCEPTED'
  | 'UNDO_REJECTED'
  | 'UNDO_EXPIRED'
  | 'UNDO_APPLIED'
  | 'PUBLIC_EVENT'
  | 'PRIVATE_EVENT'
  | 'SEALED_AUDIT'
  | 'GAME_EVENT'
  | 'CHECKPOINT_WRITTEN'
  | 'MATCH_SEALED'
  | 'DECISION_OPENED'
  | 'DECISION_SUBMITTED'
  | 'RANDOMNESS_RECORDED';

export interface ReplayRecordFrame {
  readonly matchId: string;
  readonly timelineSeq: number;
  readonly frameType: ReplayRecordFrameType;
  readonly visibilityScope: ReplayVisibilityScope;
  readonly relatedCheckpointSeq: number | null;
  readonly relatedPublicSeq: number | null;
  readonly relatedPrivateSeq: number | null;
  readonly relatedPrivateSeqBySeat?: Readonly<Record<Seat, number>>;
  readonly relatedAuditSeq: number | null;
  readonly relatedCommandSeq: number | null;
  readonly relatedGameEventSeq: number | null;
  readonly relatedDecisionId: string | null;
  readonly dedupeKey: string;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
  readonly summary: string;
  readonly createdAt: number;
}

export interface DebugReplaySourceMatch {
  readonly matchId: string;
  readonly roomCode: string;
  readonly exportedStatus: 'RUNNING_OR_RECENT';
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly lastActivityAt: number;
  readonly currentPublicSeq: number;
  readonly currentGameEventSeq: number;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
  readonly complete: boolean;
}

export interface DebugReplayParticipant {
  readonly seat: Seat;
  readonly userId: string;
  readonly displayName: string;
  readonly playerId: string;
}

export interface DebugReplayCardSummary {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: string;
  readonly cost?: number;
  readonly score?: number;
}

export interface DebugReplayDeckSnapshot {
  readonly seat: Seat;
  readonly sourceDeckId: string | null;
  readonly sourceDeckName: string | null;
  readonly source: 'ONLINE_RUNTIME_DECK';
  readonly mainDeck: readonly string[];
  readonly energyDeck: readonly string[];
  readonly cardSummaries: Readonly<Record<string, DebugReplayCardSummary>>;
  readonly validationState: 'RUNTIME_ACCEPTED';
  readonly cardDataVersion: string;
  readonly cardDataHash: string;
  readonly lockedAt: number | null;
}

export interface DebugReplayTimelineSummaryEntry {
  readonly timelineSeq: number;
  readonly frameType: ReplayRecordFrameType;
  readonly summary: string;
  readonly createdAt: number;
}

export interface DebugReplayBundle {
  readonly recordSchemaVersion: 1;
  readonly bundleSchemaVersion: 1;
  readonly serializer: ReplaySerializer;
  readonly exportedAt: number;
  readonly appVersion: string;
  readonly gitCommit: string | null;
  readonly rulesVersion: string;
  readonly cardDataVersion: string;
  readonly cardDataHash: string;
  readonly sourceMatch: DebugReplaySourceMatch;
  readonly participants: readonly DebugReplayParticipant[];
  readonly deckSnapshots: readonly DebugReplayDeckSnapshot[];
  readonly recordFrames: readonly ReplayRecordFrame[];
  readonly checkpoints: readonly ReplayCheckpointEnvelope[];
  readonly timelineSummary: readonly DebugReplayTimelineSummaryEntry[];
  readonly commands: readonly unknown[];
  readonly publicEvents: readonly unknown[];
  readonly privateEventsBySeat: Readonly<Record<Seat, readonly unknown[]>>;
  readonly sealedAudit: readonly unknown[];
  readonly gameEvents: readonly unknown[];
  readonly decisions: readonly unknown[];
  readonly capabilities: readonly ReplayCapability[];
  readonly limitations: readonly ReplayLimitation[];
}

export interface DebugReplayImportSummary {
  readonly bundleId: string;
  readonly importedAt: number;
  readonly expiresAt: number;
  readonly sourceMatch: DebugReplaySourceMatch;
  readonly capabilities: readonly ReplayCapability[];
  readonly limitations: readonly ReplayLimitation[];
  readonly checkpointCount: number;
  readonly timelineFrameCount: number;
}

export interface DebugReplayTimelineView {
  readonly bundleId: string;
  readonly importedAt: number;
  readonly expiresAt: number;
  readonly sourceMatch: DebugReplaySourceMatch;
  readonly capabilities: readonly ReplayCapability[];
  readonly limitations: readonly ReplayLimitation[];
  readonly timelineSummary: readonly DebugReplayTimelineSummaryEntry[];
  readonly recordFrames: readonly ReplayRecordFrame[];
}

export interface DebugReplayCheckpointInfo {
  readonly matchId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly checkpointType: ReplayCheckpointType;
  readonly relatedPublicSeq: number | null;
  readonly relatedCommandSeq: number | null;
  readonly relatedGameEventSeq: number | null;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
  readonly createdAt: number;
  readonly visibilityScope: ReplayVisibilityScope;
  readonly capabilities: readonly ReplayCapability[];
  readonly limitations: readonly ReplayLimitation[];
}

export interface DebugReplayCheckpointView {
  readonly bundleId: string;
  readonly viewerSeat: Seat;
  readonly checkpointInfo: DebugReplayCheckpointInfo;
  readonly recordFrame: ReplayRecordFrame | null;
  readonly playerViewState: PlayerViewState;
  readonly sourceMatch: DebugReplaySourceMatch;
  readonly capabilities: readonly ReplayCapability[];
  readonly limitations: readonly ReplayLimitation[];
}

export interface MatchRecordParticipantView {
  readonly seat: Seat;
  readonly userId: string;
  readonly displayName: string;
  readonly playerId: string;
  readonly participantKind: MatchParticipantKind;
  readonly ownerUserId: string | null;
}

export interface MatchRecordDeckSnapshotView {
  readonly seat: Seat;
  readonly sourceDeckId: string | null;
  readonly sourceDeckName: string | null;
  readonly source: MatchDeckSnapshotSource;
  readonly mainDeckCount: number;
  readonly energyDeckCount: number;
  readonly validationState: MatchDeckSnapshotValidationState;
  readonly cardDataVersion: string;
  readonly cardDataHash: string;
  readonly lockedAt: number | null;
}

export interface MatchRecordSummaryView {
  readonly matchId: string;
  readonly roomCode: string;
  readonly matchMode: MatchMode;
  readonly automationGameMode: MatchAutomationGameMode;
  readonly originKind: MatchOriginKind;
  readonly originLabel: string;
  readonly status: MatchRecordStatus;
  readonly completeness: MatchRecordCompleteness;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly sealedAt: number | null;
  readonly viewerSeat: Seat;
  readonly opponentSeat: Seat | null;
  readonly opponentUserId: string | null;
  readonly opponentDisplayName: string | null;
  readonly winnerSeat: Seat | null;
  readonly endReason: string | null;
  readonly turnCount: number;
  readonly lastTimelineSeq: number;
  readonly lastCheckpointSeq: number;
  readonly replayCapabilities: readonly ReplayCapability[];
  readonly replayLimitations: readonly ReplayLimitation[];
  readonly partialReasonSummary: string | null;
}

export interface MatchRecordDetailView extends MatchRecordSummaryView {
  readonly participants: readonly MatchRecordParticipantView[];
  readonly deckSnapshots: readonly MatchRecordDeckSnapshotView[];
}

export interface MatchRecordTimelineEntryView {
  readonly timelineSeq: number;
  readonly frameType: ReplayRecordFrameType;
  readonly visibilityScope: ReplayVisibilityScope;
  readonly summary: string;
  readonly createdAt: number;
  readonly relatedCheckpointSeq: number | null;
  readonly relatedPublicSeq: number | null;
  readonly relatedPrivateSeq: number | null;
  readonly relatedPrivateSeqForViewer: number | null;
  readonly relatedCommandSeq: number | null;
  readonly relatedGameEventSeq: number | null;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
}

export interface MatchRecordTimelineView {
  readonly matchId: string;
  readonly matchMode: MatchMode;
  readonly automationGameMode: MatchAutomationGameMode;
  readonly originKind: MatchOriginKind;
  readonly originLabel: string;
  readonly viewerSeat: Seat;
  readonly recordStatus: MatchRecordStatus;
  readonly recordCompleteness: MatchRecordCompleteness;
  readonly replayLimitations: readonly ReplayLimitation[];
  readonly partialReasonSummary: string | null;
  readonly timelineSummary: readonly MatchRecordTimelineEntryView[];
}

export interface MatchRecordVisibleEventView {
  readonly timelineSeq: number;
  readonly eventSeq: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly summary: string;
  readonly createdAt: number;
  readonly actorSeat: Seat | null;
  readonly source: string | null;
  readonly payload: unknown;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
}

export interface MatchRecordVisiblePrivateEventView {
  readonly timelineSeq: number;
  readonly eventSeq: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly summary: string;
  readonly createdAt: number;
  readonly payload: unknown;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
}

export interface MatchRecordDecisionView {
  readonly decisionId: string;
  readonly timelineSeq: number;
  readonly decisionSchemaVersion: number;
  readonly decisionType: MatchDecisionType;
  readonly status: MatchDecisionRecordStatus;
  readonly playerId: string | null;
  readonly eventIds: readonly string[];
  readonly abilityId: string | null;
  readonly sourceCardObjectId: string | null;
  readonly sourceCardCode: string | null;
  readonly sourceBaseCardCode: string | null;
  readonly sourceZone: string | null;
  readonly sourceSlot: string | null;
  readonly effectTextSnapshot: string | null;
  readonly stepId: string | null;
  readonly stepText: string | null;
  readonly waitingSeat: Seat | null;
  readonly visibleCandidates: readonly MatchDecisionCardSummary[];
  readonly visibleContextSummary: MatchDecisionVisibleContextSummary | null;
  readonly minSelect: number | null;
  readonly maxSelect: number | null;
  readonly canSkip: boolean | null;
  readonly submittedTimelineSeq: number | null;
  readonly submittedCommandSeq: number | null;
  readonly submission: MatchDecisionSubmissionSummary | null;
  readonly resultSummary: string | null;
  readonly replayCapability: ReplayCapability;
  readonly transitionSemantics: MatchDecisionTransitionSemantics;
  readonly createdAt: number;
}

export interface MatchRecordCheckpointInfo {
  readonly matchId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly checkpointType: ReplayCheckpointType;
  readonly relatedPublicSeq: number | null;
  readonly relatedCommandSeq: number | null;
  readonly relatedGameEventSeq: number | null;
  readonly turnCount: number;
  readonly phase: GamePhase | string;
  readonly subPhase: SubPhase | string;
  readonly createdAt: number;
  readonly capabilities: readonly ReplayCapability[];
}

export interface MatchRecordReplayPosition {
  readonly timelineSeq: number;
  readonly checkpointSeq: number;
}

export interface MatchRecordReplayView {
  readonly matchId: string;
  readonly sourceMatchMode: MatchMode;
  readonly automationGameMode: MatchAutomationGameMode;
  readonly originKind: MatchOriginKind;
  readonly originLabel: string;
  readonly viewerSeat: Seat;
  readonly replayPosition: MatchRecordReplayPosition;
  readonly timelineSummary: MatchRecordTimelineEntryView | null;
  readonly recordFrame: MatchRecordTimelineEntryView | null;
  readonly visibleEvents: readonly MatchRecordVisibleEventView[];
  readonly visiblePrivateEvents: readonly MatchRecordVisiblePrivateEventView[];
  readonly visibleDecisions: readonly MatchRecordDecisionView[];
  readonly checkpointInfo: MatchRecordCheckpointInfo;
  readonly playerViewState: PlayerViewState;
  readonly recordStatus: MatchRecordStatus;
  readonly recordCompleteness: MatchRecordCompleteness;
  readonly replayLimitations: readonly ReplayLimitation[];
  readonly partialReasonSummary: string | null;
}
