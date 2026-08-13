import type { Seat } from './types.js';

export type OnlineMatchEmoteId = string;

export interface OnlineMatchEmoteDefinition {
  readonly id: OnlineMatchEmoteId;
  readonly label: string;
  readonly shortLabel: string;
  readonly staticImageUrl: string;
  readonly animatedImageUrl: string | null;
  readonly assetRevision: string;
}

export interface OnlineMatchEmoteCatalog {
  readonly version: string;
  readonly items: readonly OnlineMatchEmoteDefinition[];
}

export interface OnlineMatchEmoteSnapshot {
  readonly label: string;
  readonly staticImageUrl: string;
  readonly animatedImageUrl: string | null;
  readonly assetRevision: string;
}

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
      readonly emote: OnlineMatchEmoteSnapshot;
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
      readonly catalogVersion: string;
    };
