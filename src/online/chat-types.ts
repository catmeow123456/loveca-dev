import type { Seat } from './types.js';

export const ONLINE_MATCH_CHAT_SCHEMA_VERSION = 'loveca.online-match-chat/v2' as const;

export const ONLINE_MATCH_EMOTE_IDS = [
  'DEEP_THINKING',
  'THANK_YOU',
  'NICE_TO_MEET_YOU',
  'NICE_PLAY',
  'GOOD_GAME',
  'SORRY_TO_KEEP_YOU_WAITING',
] as const;

export type OnlineMatchEmoteId = (typeof ONLINE_MATCH_EMOTE_IDS)[number];

interface OnlineMatchChatEntryBase {
  readonly messageSeq: number;
  readonly sentAt: number;
}

interface OnlineMatchPlayerChatMessageBase extends OnlineMatchChatEntryBase {
  readonly messageType: 'PLAYER';
  readonly senderSeat: Seat;
  readonly senderDisplayName: string;
}

export interface OnlineMatchPlayerTextMessage extends OnlineMatchPlayerChatMessageBase {
  readonly kind: 'TEXT';
  readonly text: string;
}

export interface OnlineMatchPlayerEmoteMessage extends OnlineMatchPlayerChatMessageBase {
  readonly kind: 'EMOTE';
  readonly emoteId: OnlineMatchEmoteId;
}

export type OnlineMatchSystemNoticeCode =
  'AI_FALLBACK_ENABLED' | 'AI_LIVENESS_CONCEDE' | 'AI_MACHINE_FAILURE';

export interface OnlineMatchSystemNotice extends OnlineMatchChatEntryBase {
  readonly kind: 'SYSTEM_NOTICE';
  readonly messageType: 'SYSTEM_NOTICE';
  readonly noticeCode: OnlineMatchSystemNoticeCode;
  readonly text: string;
}

export type OnlineMatchChatEntry =
  | OnlineMatchPlayerTextMessage
  | OnlineMatchPlayerEmoteMessage
  | OnlineMatchSystemNotice;

export type OnlineMatchChatMessage = OnlineMatchChatEntry;

export interface OnlineMatchChatMessagesResponse {
  readonly matchId: string;
  readonly messages: readonly OnlineMatchChatEntry[];
  readonly currentSeq: number;
  readonly nextAfterSeq: number;
  readonly oldestAvailableSeq: number;
  readonly truncated: boolean;
  readonly hasMore: boolean;
}

export type SendOnlineMatchChatEntryInput =
  | {
      readonly kind: 'TEXT';
      readonly clientMessageId: string;
      readonly text: string;
    }
  | {
      readonly kind: 'EMOTE';
      readonly clientMessageId: string;
      readonly emoteId: OnlineMatchEmoteId;
    };

export type SendOnlineMatchChatMessageInput = SendOnlineMatchChatEntryInput;
