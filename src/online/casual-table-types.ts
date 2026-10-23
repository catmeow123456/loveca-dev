import type { CardType } from '../shared/types/enums.js';
export type CasualTableState =
  'WAITING' | 'RESERVED' | 'BUILDING' | 'BOOTSTRAPPING' | 'BOUND' | 'CLOSED';
export type CasualTableDiscoverability = 'PUBLIC' | 'UNLISTED';

/** Every write targets a particular preparation round, never just a reusable room code. */
export interface CasualTableCommandTarget {
  readonly tableId: string;
  readonly roundId: string;
  readonly revision: number;
}

export type CasualFormat = 'CONSTRUCTED' | 'SEALED_BP7';
export type SealedRematchKind = 'SAME_POOL' | 'REBOX';
export interface SealedRematch {
  readonly requestId: string;
  readonly requesterUserId: string;
  readonly kind: SealedRematchKind;
  readonly expiresAt: number;
}
export interface SealedPoolView {
  readonly poolId: string;
  readonly version: string;
  readonly draftRevision: number;
  readonly selectedIndices: readonly number[];
  readonly cards: readonly {
    readonly index: number;
    readonly cardCode: string;
    readonly imageFilename?: string;
    readonly name: string;
    readonly cardType: CardType;
    readonly rare: string;
    readonly cost: number | null;
    readonly score: number | null;
    readonly groupNames: readonly string[];
    readonly cardText: string;
  }[];
}

export interface CasualTableEntryInput {
  readonly format: CasualFormat;
  readonly ruleMode: CasualRuleMode;
  readonly requestId: string;
  readonly deckId?: string;
  readonly spectatorEnabled: boolean;
}

export interface CreateCasualTableInput extends CasualTableEntryInput {
  readonly discoverability: CasualTableDiscoverability;
  readonly note: string;
  /** Empty or omitted requests an automatically generated code. */
  readonly roomCode?: string;
}

/** Private preparation projection. Only the caller's deck identity is included. */
export interface CasualTableOwnView extends CasualTableCommandTarget {
  readonly format: CasualFormat;
  readonly sealedPool: SealedPoolView | null;
  readonly sealedRematch: SealedRematch | null;
  readonly ruleMode: CasualRuleMode;
  readonly roomCode: string;
  readonly discoverability: CasualTableDiscoverability;
  readonly note: string;
  readonly state: CasualTableState;
  readonly waitingSince: number;
  readonly confirmationExpiresAt: number | null;
  readonly ownDeck: {
    readonly id: string | null;
    readonly name: string;
    readonly pointTotal: number;
    readonly pointLimit: number;
  } | null;
  readonly spectatorEnabled: boolean;
  readonly members: readonly {
    readonly userId: string;
    readonly displayName: string;
    readonly confirmed: boolean;
  }[];
  readonly roomGeneration: string | null;
  readonly failureReason: string | null;
  readonly runtime: CasualRuntimeView | null;
  readonly canRematch: boolean;
  readonly canContinuePublic: boolean;
}

export interface CasualTableCurrentView {
  readonly notice?: {
    readonly tableId: string;
    readonly roomCode: string;
    readonly reason: string;
  };
  readonly table: CasualTableOwnView | null;
  /** Other modes remain owned by their existing services. */
  readonly otherParticipation: {
    readonly kind: string;
    readonly destination: 'ranked' | 'theme-table' | 'online-room';
    readonly roomGeneration: string | null;
    readonly matchId: string | null;
  } | null;
}

export interface CasualRuntimeView {
  readonly status: 'OPENING' | 'PLAYING' | 'ENDED';
  readonly matchId: string | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly departedUserIds: readonly string[];
  readonly spectatorViews: readonly {
    readonly seat: 'FIRST' | 'SECOND';
    readonly displayName: string;
  }[];
  readonly rematch: {
    readonly requestId: string;
    readonly requesterUserId: string;
    readonly responderUserId: string;
    readonly expiresAt: number;
  } | null;
}

export interface CasualRoomSummary extends CasualTableCommandTarget {
  readonly format: CasualFormat;
  readonly ruleMode: CasualRuleMode;
  readonly roomCode: string;
  readonly note: string;
  readonly status: 'WAITING' | 'RESERVED' | 'BUILDING' | 'OPENING' | 'PLAYING' | 'ENDED';
  readonly members: readonly { readonly userId: string; readonly displayName: string }[];
  readonly since: number;
  readonly canJoin: boolean;
  readonly isMine: boolean;
  readonly spectatorViews: CasualRuntimeView['spectatorViews'];
}

export interface CasualLobbyQuery {
  readonly format?: CasualFormat;
  readonly ruleMode?: CasualRuleMode;
  readonly filter?: 'ALL' | 'WAITING' | 'PLAYING';
  readonly search?: string;
  readonly spectatable?: boolean;
  readonly cursor?: string;
}

export interface CasualLobbyView {
  readonly rooms: readonly CasualRoomSummary[];
  readonly counts: {
    readonly waiting: number;
    readonly preparing: number;
    readonly playing: number;
  };
  readonly nextCursor: string | null;
  readonly snapshotAt: number;
  readonly unavailableReason: string | null;
}
import type { CasualRuleMode } from '../domain/rules/deck-construction.js';
export type { CasualRuleMode } from '../domain/rules/deck-construction.js';
