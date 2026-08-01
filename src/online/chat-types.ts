import type { Seat } from './types.js';

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
  readonly senderSeat: Seat;
  readonly senderDisplayName: string;
  readonly sentAt: number;
}

export type OnlineMatchChatEntry =
  | (OnlineMatchChatEntryBase & {
      readonly kind: 'TEXT';
      readonly text: string;
    })
  | (OnlineMatchChatEntryBase & {
      readonly kind: 'EMOTE';
      readonly emoteId: OnlineMatchEmoteId;
    });

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
