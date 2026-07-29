import type { Seat } from './types.js';

export const ONLINE_MATCH_CHAT_SCHEMA_VERSION = 'loveca.online-match-chat/v2' as const;

interface OnlineMatchChatMessageBase {
  readonly messageSeq: number;
  readonly text: string;
  readonly sentAt: number;
}

export interface OnlineMatchPlayerChatMessage extends OnlineMatchChatMessageBase {
  readonly messageType: 'PLAYER';
  readonly senderSeat: Seat;
  readonly senderDisplayName: string;
}

export type OnlineMatchSystemNoticeCode =
  'AI_MATCH_READY' | 'AI_FALLBACK_ENABLED' | 'AI_LIVENESS_CONCEDE' | 'AI_MACHINE_FAILURE';

export interface OnlineMatchSystemNotice extends OnlineMatchChatMessageBase {
  readonly messageType: 'SYSTEM_NOTICE';
  readonly noticeCode: OnlineMatchSystemNoticeCode;
}

export type OnlineMatchChatMessage = OnlineMatchPlayerChatMessage | OnlineMatchSystemNotice;

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
