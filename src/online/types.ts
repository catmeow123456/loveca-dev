import {
  CardType,
  FaceState,
  GameMode,
  OrientationState,
} from '../shared/types/enums.js';
import type { GameState } from '../domain/entities/game.js';

export type Seat = 'FIRST' | 'SECOND';

export type ViewerSurface = 'NONE' | 'BACK' | 'FRONT';

export type PublicEventSource = 'PLAYER' | 'SYSTEM';

export type PublicWindowType =
  | 'SERIAL_PRIORITY'
  | 'INSPECTION'
  | 'SIMULTANEOUS_COMMIT'
  | 'RESULT_ANIMATION'
  | 'SHARED_CONFIRM';

export type WindowStatus = 'OPENED' | 'UPDATED' | 'CLOSED';

export type ViewZoneKey = `${Seat}_${string}` | 'SHARED_RESOLUTION_ZONE';

export interface ViewWindowState {
  readonly windowType: PublicWindowType;
  readonly status: WindowStatus;
  readonly actingSeat?: Seat | null;
  readonly waitingSeats: readonly Seat[];
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface MatchViewState {
  readonly matchId: string;
  readonly viewerSeat: Seat;
  readonly participants: Readonly<Record<Seat, ViewParticipant>>;
  readonly turnCount: number;
  readonly phase: string;
  readonly subPhase: string;
  readonly activeSeat: Seat | null;
  readonly prioritySeat: Seat | null;
  readonly window: ViewWindowState | null;
  readonly liveResult?: LiveResultViewState;
  readonly seq: number;
}

export interface ViewParticipant {
  readonly id: string;
  readonly name: string;
}

export interface LiveResultViewState {
  readonly scores: Readonly<Record<Seat, number>>;
  readonly winnerSeats: readonly Seat[];
  readonly confirmedSeats: readonly Seat[];
}

export interface ViewZoneState {
  readonly zone: string;
  readonly ownerSeat?: Seat;
  readonly count: number;
  readonly ordered: boolean;
  readonly objectIds?: readonly string[];
  readonly slotMap?: Readonly<Record<string, string | null>>;
  readonly overlays?: Readonly<Record<string, readonly string[]>>;
}

export interface TableViewState {
  readonly zones: Readonly<Record<ViewZoneKey, ViewZoneState>>;
}

export interface ViewFrontCardInfo {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: CardType;
  readonly cost?: number;
  readonly score?: number;
  readonly requiredHearts?: unknown;
  readonly hearts?: unknown;
  readonly bladeHearts?: unknown;
  readonly text?: string;
}

export interface ViewCardObject {
  readonly publicObjectId: string;
  readonly ownerSeat: Seat;
  readonly controllerSeat: Seat;
  readonly cardType?: CardType;
  readonly surface: ViewerSurface;
  readonly orientation?: OrientationState;
  readonly faceState?: FaceState;
  readonly publiclyRevealed?: boolean;
  readonly judgmentResult?: boolean;
  readonly enteredStageThisTurn?: boolean;
  readonly frontInfo?: ViewFrontCardInfo;
}

export interface ViewCommandScope {
  readonly zoneKeys?: readonly ViewZoneKey[];
  readonly objectIds?: readonly string[];
}

export interface ViewCommandHint {
  readonly command: string;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly scope?: ViewCommandScope;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface PermissionViewState {
  readonly availableCommands: readonly ViewCommandHint[];
}

export interface UiHintViewState {
  readonly gameMode: GameMode;
  readonly isLocalMode: boolean;
}

export interface PlayerViewState {
  readonly match: MatchViewState;
  readonly table: TableViewState;
  readonly objects: Readonly<Record<string, ViewCardObject>>;
  readonly permissions: PermissionViewState;
  readonly uiHints?: UiHintViewState;
}

export interface PublicCardInfo {
  readonly publicObjectId: string;
  readonly cardCode?: string;
  readonly name?: string;
  readonly cardType?: CardType;
}

export interface PublicZoneRef {
  readonly zone: string;
  readonly ownerSeat?: Seat;
  readonly slot?: string;
  readonly index?: number;
  readonly overlayIndex?: number;
}

export interface PrivateEvent {
  readonly type: string;
  readonly eventId: string;
  readonly matchId: string;
  readonly seq: number;
  readonly timestamp: number;
  readonly seat: Seat;
  readonly relatedPublicSeq: number;
  readonly payload?: unknown;
}

export interface SealedAuditRecord {
  readonly type: string;
  readonly recordId: string;
  readonly matchId: string;
  readonly seq: number;
  readonly timestamp: number;
  readonly actorSeat?: Seat;
  readonly relatedPublicSeq: number;
  readonly payload?: unknown;
}

export interface MatchCommandRecord {
  readonly recordId: string;
  readonly matchId: string;
  readonly seq: number;
  readonly timestamp: number;
  readonly playerId: string;
  readonly actorSeat?: Seat;
  readonly commandType: string;
  readonly payload?: unknown;
  readonly idempotencyKey?: string;
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly resultingPublicSeq: number;
  readonly error?: string;
}

export interface MatchSnapshotSummary {
  readonly matchId: string;
  readonly publicSeq: number;
  readonly createdAt: number;
}

export interface PlayerRecoveryFrame {
  readonly matchId: string;
  readonly viewerSeat: Seat;
  readonly snapshotPublicSeq: number;
  readonly currentPublicSeq: number;
  readonly playerViewState: PlayerViewState;
  readonly publicEvents: readonly PublicEvent[];
  readonly privateEvents: readonly PrivateEvent[];
}

export interface AuthoritativeRecoveryFrame {
  readonly matchId: string;
  readonly snapshotPublicSeq: number;
  readonly currentPublicSeq: number;
  readonly gameState: GameState;
  readonly publicEvents: readonly PublicEvent[];
  readonly sealedAudit: readonly SealedAuditRecord[];
  readonly commandLog: readonly MatchCommandRecord[];
}

export interface BasePublicEvent {
  readonly type: string;
  readonly eventId: string;
  readonly matchId: string;
  readonly seq: number;
  readonly timestamp: number;
  readonly source: PublicEventSource;
  readonly actorSeat?: Seat;
}

export interface PhaseStartedPublicEvent extends BasePublicEvent {
  readonly type: 'PhaseStarted';
  readonly phase: string;
  readonly activeSeat: Seat | null;
}

export interface SubPhaseStartedPublicEvent extends BasePublicEvent {
  readonly type: 'SubPhaseStarted';
  readonly subPhase: string;
  readonly activeSeat: Seat | null;
}

export interface WindowStatusChangedPublicEvent extends BasePublicEvent {
  readonly type: 'WindowStatusChanged';
  readonly windowType: PublicWindowType | null;
  readonly status: WindowStatus;
  readonly actingSeat: Seat | null;
  readonly waitingSeats: readonly Seat[];
  readonly window: ViewWindowState | null;
}

export interface PlayerDeclaredPublicEvent extends BasePublicEvent {
  readonly type: 'PlayerDeclared';
  readonly declarationType: string;
  readonly publicValue?: string | number | boolean | null;
}

export interface CardMovedPublicEvent extends BasePublicEvent {
  readonly type: 'CardMovedPublic';
  readonly card?: PublicCardInfo;
  readonly from?: PublicZoneRef;
  readonly to?: PublicZoneRef;
  readonly count?: number;
}

export interface CardsInspectedSummaryPublicEvent extends BasePublicEvent {
  readonly type: 'CardsInspectedSummary';
  readonly sourceZone: string;
  readonly ownerSeat?: Seat;
  readonly count: number;
}

export interface CardRevealedPublicEvent extends BasePublicEvent {
  readonly type: 'CardRevealed';
  readonly card: PublicCardInfo;
  readonly from?: PublicZoneRef;
  readonly reason?: string;
}

export interface CardRevealedAndMovedPublicEvent extends BasePublicEvent {
  readonly type: 'CardRevealedAndMoved';
  readonly card: PublicCardInfo;
  readonly from?: PublicZoneRef;
  readonly to?: PublicZoneRef;
  readonly reason?: string;
}

export interface DeckRefreshedPublicEvent extends BasePublicEvent {
  readonly type: 'DeckRefreshed';
  readonly ownerSeat: Seat;
  readonly movedCount: number;
  readonly mainDeckCountAfter: number;
}

export type PublicEvent =
  | PhaseStartedPublicEvent
  | SubPhaseStartedPublicEvent
  | WindowStatusChangedPublicEvent
  | PlayerDeclaredPublicEvent
  | CardMovedPublicEvent
  | CardsInspectedSummaryPublicEvent
  | CardRevealedPublicEvent
  | CardRevealedAndMovedPublicEvent
  | DeckRefreshedPublicEvent;

export type PublicEventDraft =
  | Omit<PhaseStartedPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<SubPhaseStartedPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<WindowStatusChangedPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<PlayerDeclaredPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<CardMovedPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<CardsInspectedSummaryPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<CardRevealedPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<CardRevealedAndMovedPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>
  | Omit<DeckRefreshedPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>;

export type PrivateEventDraft = Omit<
  PrivateEvent,
  'eventId' | 'matchId' | 'seq' | 'timestamp' | 'seat' | 'relatedPublicSeq'
>;

export type SealedAuditRecordDraft = Omit<
  SealedAuditRecord,
  'recordId' | 'matchId' | 'seq' | 'timestamp' | 'relatedPublicSeq'
>;
