export type PublicTablePlayerState =
  'IDLE' | 'WAITING' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'CREATING_ROOM' | 'MATCHED';

export interface PublicTableSummaryView {
  readonly open: boolean;
  readonly hasWaitingPlayer: boolean;
  readonly unavailableReason: string | null;
}

export interface PublicTableStatusView {
  readonly state: PublicTablePlayerState;
  readonly ticketId: string | null;
  readonly joinedAt: number | null;
  readonly deckName: string | null;
  readonly reservationId: string | null;
  readonly confirmationExpiresAt: number | null;
  readonly confirmed: boolean;
  readonly roomCode: string | null;
  readonly roomGeneration: string | null;
  readonly message: string | null;
}
