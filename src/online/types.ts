import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GameMode,
  HeartColor,
  OrientationState,
} from '../shared/types/enums.js';
import type { GameState } from '../domain/entities/game.js';
import type { HeartIcon } from '../domain/entities/card.js';

export type Seat = 'FIRST' | 'SECOND';

export type UndoPolicy = 'NONE' | 'LOCAL_IMMEDIATE' | 'REMOTE_IMMEDIATE' | 'REMOTE_REQUEST';

export interface UndoRuntimeCaptureCursor {
  readonly publicSeq: number;
  readonly privateSeqBySeat: Readonly<Record<Seat, number>>;
  readonly auditSeq: number;
  readonly commandSeq: number;
  readonly gameEventSeq: number;
}

export interface UndoEntrySummary {
  readonly undoEntryId: string;
  readonly actorPlayerId: string;
  readonly actorSeat: Seat;
  readonly label: string;
  readonly boundaryKey: string;
  readonly createdAt: number;
  readonly beforeCommandSeq: number;
  readonly afterCommandSeq: number;
  readonly beforePublicSeq: number;
  readonly afterPublicSeq: number;
  readonly beforeGameEventSeq: number;
  readonly afterGameEventSeq: number;
  readonly beforeCaptureCursor: UndoRuntimeCaptureCursor;
  readonly afterCaptureCursor: UndoRuntimeCaptureCursor;
  readonly hasHumanOpponentReveal: boolean;
  readonly hasRandomOrShuffle: boolean;
  /** 首版远程撤销由服务层通过最新 undoEntryId、revision 与 pending 请求失效判断对手后续操作。 */
  readonly hasOpponentFollowup: boolean;
}

export interface UndoRequestView {
  readonly requestId: string;
  readonly requesterSeat: Seat;
  readonly targetUndoEntryId: string;
  readonly targetRevision: number;
  readonly summary: string;
  readonly expiresAt: string;
}

export interface OnlineUndoView {
  readonly policy: UndoPolicy;
  readonly canUndoNow: boolean;
  readonly disabledReason: string | null;
  readonly entry: UndoEntrySummary | null;
  readonly pendingRequest: UndoRequestView | null;
}

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
  readonly undo?: OnlineUndoView;
  readonly seq: number;
}

export interface ViewParticipant {
  readonly id: string;
  readonly name: string;
}

export interface LiveResultViewState {
  readonly scores: Readonly<Record<Seat, number>>;
  readonly scoreModifiers: Readonly<Record<Seat, number>>;
  readonly heartBonuses: Readonly<Record<Seat, readonly HeartIcon[]>>;
  /** 当前仅投影无色/All 必要 Heart 减少；彩色/增加修正应升级为 modifier 列表 */
  readonly requirementReductions: Readonly<Record<string, number>>;
  readonly requirementModifiers: Readonly<
    Record<string, readonly { color: HeartColor; countDelta: number }[]>
  >;
  readonly liveCardScoreModifiers: Readonly<Record<string, number>>;
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
  /** 每个槽位下方堆叠的成员卡 ID（特殊成员卡效果） */
  readonly memberBelow?: Readonly<Record<string, readonly string[]>>;
}

export interface ViewHeartIcon {
  readonly color: HeartColor;
  readonly count: number;
}

export interface ViewMemberModifierDelta {
  readonly bladeDelta?: number;
  readonly heartDeltas?: readonly ViewHeartIcon[];
}

export interface ViewBladeHeartItem {
  readonly effect: BladeHeartEffect;
  readonly heartColor?: HeartColor;
}

export interface ViewHeartRequirement {
  readonly colorRequirements: Readonly<Partial<Record<HeartColor, number>>>;
  readonly totalRequired: number;
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
  readonly requiredHearts?: ViewHeartRequirement;
  readonly hearts?: readonly ViewHeartIcon[];
  readonly modifierDelta?: ViewMemberModifierDelta;
  readonly bladeHearts?: readonly ViewBladeHeartItem[];
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
  /** GameSession 规则自动化策略；不是桌面 UI 场景或权威来源。 */
  readonly gameMode: GameMode;
}

export interface PlayerViewState {
  readonly match: MatchViewState;
  readonly table: TableViewState;
  readonly objects: Readonly<Record<string, ViewCardObject>>;
  readonly permissions: PermissionViewState;
  readonly activeEffect?: ActiveEffectViewState | null;
  readonly pendingCostPayment?: PendingCostPaymentViewState | null;
  readonly uiHints?: UiHintViewState;
}

export interface ActiveEffectViewState {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceObjectId: string;
  readonly controllerSeat: Seat | null;
  readonly effectText: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly waitingSeat: Seat | null;
  readonly revealedObjectIds?: readonly string[];
  readonly inspectionObjectIds?: readonly string[];
  readonly selectableObjectIds?: readonly string[];
  readonly selectableObjectMode?: 'SINGLE' | 'ORDERED_MULTI';
  readonly minSelectableObjects?: number;
  readonly maxSelectableObjects?: number;
  readonly selectableSlots?: readonly string[];
  readonly selectableOptions?: readonly { readonly id: string; readonly label: string }[];
  readonly numericInput?: {
    readonly min?: number;
    readonly integerOnly?: boolean;
    readonly label?: string;
    readonly placeholder?: string;
    readonly confirmLabel?: string;
  };
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly canResolveInOrder?: boolean;
  readonly canSkipSelection?: boolean;
  readonly skipSelectionLabel?: string;
}

export interface PendingCostPaymentViewState {
  readonly id: string;
  readonly source: string;
  readonly sourceObjectId: string;
  readonly playerSeat: Seat | null;
  readonly targetSlot?: string;
  readonly baseCost: number;
  readonly finalEnergyCost: number;
  readonly relayDiscount: number;
  readonly replacedMemberObjectId: string | null;
  readonly payableEnergyObjectIds: readonly string[];
  readonly explanation?: string;
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
