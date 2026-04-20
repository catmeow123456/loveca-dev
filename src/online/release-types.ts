import type { Seat } from './types.js';
import type { RemoteCommandResult, RemoteMatchSnapshot } from './remote-match-types.js';

export type OnlineRoomStatus = 'PREPARING' | 'READY' | 'IN_GAME';
export type OnlineRoomMemberRole = 'HOST' | 'GUEST';
export type OnlineRoomMemberPresence = 'ACTIVE' | 'LEFT';
export type TurnOrderProposalMode = 'HOST_FIRST' | 'HOST_SECOND';

export interface OnlineRoomMemberView {
  readonly userId: string;
  readonly displayName: string;
  readonly role: OnlineRoomMemberRole;
  readonly presence: OnlineRoomMemberPresence;
  readonly lockedDeckId: string | null;
  readonly lockedDeckName: string | null;
  readonly ready: boolean;
  readonly seat?: Seat;
}

export interface OnlineTurnOrderProposalView {
  readonly proposal: TurnOrderProposalMode;
  readonly proposedByUserId: string;
  readonly proposedAt: number;
}

export interface OnlineTurnOrderAgreementView {
  readonly accepted: boolean;
  readonly respondedByUserId: string;
  readonly respondedAt: number;
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
  readonly turnOrderProposal: OnlineTurnOrderProposalView | null;
  readonly turnOrderAgreement: OnlineTurnOrderAgreementView | null;
  readonly matchId: string | null;
  readonly updatedAt: number;
}

export interface OnlineMatchSnapshot extends RemoteMatchSnapshot {}

export type OnlineCommandResult = RemoteCommandResult<OnlineMatchSnapshot>;
