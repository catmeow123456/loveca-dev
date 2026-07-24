import type { Seat } from './types.js';
import type { RemoteCommandResult, RemoteMatchSnapshot } from './remote-match-types.js';
import type { MatchOriginKind } from './replay-types.js';

export type OnlineRoomStatus = 'PREPARING' | 'READY' | 'OPENING' | 'IN_GAME';
export type OnlineRoomMemberRole = 'HOST' | 'GUEST';
export type OnlineRoomMemberPresence = 'ACTIVE' | 'LEFT';
export type OpeningRpsGesture = 'ROCK' | 'PAPER' | 'SCISSORS';
export type OpeningTurnOrderChoice = 'SELF_FIRST' | 'SELF_SECOND';
export type OnlineSpectatorViewType = 'PLAYER';
export type OnlineSpectatorLinkSource = 'ADMIN_LINK' | 'ROOM_CODE';
export type OnlineSpectatorAccessEndReason =
  'ROOM_CLOSED' | 'ROOM_REPLACED' | 'AUTHORIZATION_CLOSED' | 'SESSION_EXPIRED';

export interface OnlineOpeningRpsChoiceView {
  readonly userId: string;
  readonly selected: boolean;
  readonly gesture: OpeningRpsGesture | null;
}

export interface OnlineOpeningRpsView {
  readonly round: number;
  readonly choices: readonly OnlineOpeningRpsChoiceView[];
  readonly revealed: boolean;
  readonly winnerUserId: string | null;
  readonly chooserUserId: string | null;
  readonly revealedAt: number | null;
}

export interface OnlineRoomMemberView {
  readonly userId: string;
  readonly displayName: string;
  readonly role: OnlineRoomMemberRole;
  readonly presence: OnlineRoomMemberPresence;
  readonly lockedDeckId: string | null;
  readonly lockedDeckName: string | null;
  readonly ready: boolean;
  readonly startReady: boolean;
  readonly seat?: Seat;
}

export interface OnlineRestartRequestView {
  readonly requestId: string;
  readonly requesterUserId: string;
  readonly responderUserId: string;
  readonly matchId: string;
  readonly requestedAt: number;
  readonly expiresAt: number;
}

export interface OnlineRoomView {
  readonly roomCode: string;
  readonly originKind: MatchOriginKind;
  readonly status: OnlineRoomStatus;
  readonly ownerUserId: string;
  readonly currentUserId: string;
  readonly currentUserRole: OnlineRoomMemberRole;
  readonly currentUserPresence: OnlineRoomMemberPresence;
  readonly currentUserSeat?: Seat;
  readonly members: readonly OnlineRoomMemberView[];
  readonly openingRps: OnlineOpeningRpsView | null;
  readonly restartRequest: OnlineRestartRequestView | null;
  readonly matchId: string | null;
  readonly spectatorRoomEntry: OnlineRoomSpectatorEntryView | null;
  readonly spectatorPresence: OnlineSpectatorPresenceView;
  readonly updatedAt: number;
}

export type OnlineMatchSnapshot = RemoteMatchSnapshot;

export type OnlineCommandResult = RemoteCommandResult<OnlineMatchSnapshot>;

export interface OnlineSpectatorLinkView {
  readonly token: string;
  readonly source: OnlineSpectatorLinkSource;
  readonly matchId: string | null;
  readonly roomCode: string;
  readonly roomGeneration: string | null;
  readonly attachmentGeneration: number;
  readonly viewType: OnlineSpectatorViewType;
  readonly viewerSeat: Seat | null;
  readonly authorizedViewerSeats: readonly Seat[];
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly path: string;
}

export interface OnlineSpectatorSessionView {
  readonly sessionId: string;
  readonly displayName: string;
  readonly viewType: OnlineSpectatorViewType;
  readonly viewerSeat: Seat | null;
  readonly authorizedViewerSeats: readonly Seat[];
  readonly attachmentGeneration: number;
  readonly preferredViewerDisplayName: string | null;
  readonly effectiveViewerDisplayName: string | null;
  readonly viewVersion: number;
  readonly joinedAt: number;
  readonly lastSeenAt: number;
}

export interface OnlineSpectatorPresenceView {
  readonly total: number;
  readonly viewers: readonly OnlineSpectatorSessionView[];
}

export interface OnlineSpectatorJoinView {
  readonly link: OnlineSpectatorLinkView;
  readonly session: OnlineSpectatorSessionView;
  readonly snapshot: OnlineSpectatorMatchSnapshot | OnlineSpectatorWaitingView;
}

export interface OnlineSpectatorViewState {
  readonly currentViewerSeat: Seat;
  readonly authorizedViewerSeats: readonly Seat[];
  readonly roomCode: string;
  readonly roomGeneration: string | null;
  readonly attachmentGeneration: number;
  readonly preferredViewerDisplayName: string | null;
  readonly effectiveViewerDisplayName: string | null;
  readonly viewVersion: number;
  readonly authorizationNotice: OnlineSpectatorAuthorizationNotice | null;
}

export interface OnlineSpectatorAuthorizationNotice {
  readonly code: 'VIEW_AUTHORIZATION_CLOSED';
  readonly closedViewerSeats: readonly Seat[];
  readonly autoSwitched: boolean;
  readonly message: string;
}

export type OnlineSpectatorMatchSnapshot = OnlineMatchSnapshot & {
  readonly spectatorView: OnlineSpectatorViewState;
};

export interface OnlineSpectatorSwitchView {
  readonly session: OnlineSpectatorSessionView;
  readonly snapshot: OnlineSpectatorMatchSnapshot;
}

export interface OnlineSpectatorWaitingView {
  readonly status: 'WAITING_NEXT_MATCH';
  readonly roomCode: string;
  readonly roomGeneration: string;
  readonly attachmentGeneration: number;
  readonly previousMatchId: string;
  readonly preferredViewerDisplayName: string | null;
  readonly effectiveViewerDisplayName: string | null;
  readonly retryAfterMs: number;
}

export interface OnlineRoomSpectatorSeatView {
  readonly seat: Seat;
  readonly displayName: string;
  readonly enabled: boolean;
}

export interface OnlineRoomSpectatorEntryView {
  readonly roomCode: string;
  readonly status: OnlineRoomStatus;
  readonly matchId: string | null;
  readonly seats: readonly OnlineRoomSpectatorSeatView[];
}

export type OnlineSpectatorSnapshotResponse =
  OnlineSpectatorMatchSnapshot | OnlineSpectatorSnapshotNotModified | OnlineSpectatorWaitingView;

export interface OnlineSpectatorSnapshotNotModified extends OnlineMatchSnapshotNotModified {
  readonly spectatorView: OnlineSpectatorViewState;
}

export interface OnlineMatchSnapshotNotModified {
  readonly matchId: string;
  readonly seq: number;
  readonly currentPublicSeq: number;
  readonly modified: false;
}

export type OnlineMatchSnapshotResponse = OnlineMatchSnapshot | OnlineMatchSnapshotNotModified;

export interface OnlineAdminRoomMemberSummary {
  readonly userId: string;
  readonly displayName: string;
  readonly role: OnlineRoomMemberRole;
  readonly presence: OnlineRoomMemberPresence;
  readonly lockedDeckId: string | null;
  readonly lockedDeckName: string | null;
  readonly ready: boolean;
  readonly startReady: boolean;
  readonly seat?: Seat;
  readonly lastSeenAt: number;
}

export interface OnlineAdminMatchSummary {
  readonly matchId: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly updatedAt: number;
  readonly lastActivityAt: number;
  readonly seq: number;
  readonly turnCount: number;
  readonly phase: string;
  readonly subPhase: string;
  readonly activeSeat: Seat | null;
}

export interface OnlineAdminRoomSummary {
  readonly roomCode: string;
  readonly status: OnlineRoomStatus;
  readonly ownerUserId: string;
  readonly members: readonly OnlineAdminRoomMemberSummary[];
  readonly openingRps: OnlineOpeningRpsView | null;
  readonly restartRequest: OnlineRestartRequestView | null;
  readonly matchId: string | null;
  readonly match: OnlineAdminMatchSummary | null;
  readonly updatedAt: number;
}
