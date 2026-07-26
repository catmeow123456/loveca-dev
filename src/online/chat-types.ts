import type { Seat } from './types.js';

export interface OnlineMatchChatMessage {
  readonly messageSeq: number;
  readonly senderSeat: Seat;
  readonly senderDisplayName: string;
  readonly text: string;
  readonly sentAt: number;
}

export interface OnlineMatchChatMessagesResponse {
  readonly matchId: string;
  readonly messages: readonly OnlineMatchChatMessage[];
  readonly currentSeq: number;
  readonly nextAfterSeq: number;
  readonly oldestAvailableSeq: number;
  readonly truncated: boolean;
  readonly hasMore: boolean;
}

export interface SendOnlineMatchChatMessageInput {
  readonly clientMessageId: string;
  readonly text: string;
}
