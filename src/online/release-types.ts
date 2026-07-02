import type { Seat } from './types.js';
import type { RemoteCommandResult, RemoteMatchSnapshot } from './remote-match-types.js';

export type OnlineRoomStatus = 'PREPARING' | 'READY' | 'OPENING' | 'IN_GAME';
export type OnlineRoomMemberRole = 'HOST' | 'GUEST';
export type OnlineRoomMemberPresence = 'ACTIVE' | 'LEFT';
export type OpeningRpsGesture = 'ROCK' | 'PAPER' | 'SCISSORS';
export type OpeningTurnOrderChoice = 'SELF_FIRST' | 'SELF_SECOND';

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
  readonly updatedAt: number;
}

export type OnlineMatchSnapshot = RemoteMatchSnapshot;

export type OnlineCommandResult = RemoteCommandResult<OnlineMatchSnapshot>;

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
