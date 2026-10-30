import type { SlotPosition, OrientationState } from './types/enums.js';
import type { PendingAbilityState } from '../domain/entities/game.js';
import type { HeartIcon } from '../domain/entities/card.js';

/** Only the new theatre presentation is print-specific; rules remain shared by base code. */
export const isShizukuSec = (code: string) => code === 'PL!N-bp7-003-SEC';

/** Public entrance identity shared by authority and cosmetic registry. */
export const entranceCards = {
  ginko: 'PL!HS-bp8-004',
  kanata: 'PL!N-bp7-006',
  ren: 'PL!SP-pb2-005',
  shiki: 'PL!SP-pb2-008',
  'next-step-trio': 'LL-bp2-001',
  hime: 'PL!HS-sd1-006',
  lanzhu: 'PL!N-bp1-012',
  eli: 'PL!-pb2-020',
  honoka: 'PL!-pb2-001',
  'rin-hanayo': 'PL!-pb2-000',
  'sumire-double': 'PL!SP-bp4-004',
  'chisato-natsumi': 'PL!SP-pb2-000',
  'kanan-mari': 'PL!S-pb2-000',
  seras: 'PL!HS-bp6-007',
  'seras-bp8': 'PL!HS-bp8-007',
  kaho: 'PL!HS-pb1-009',
  rurino: 'PL!HS-pb1-003',
  you: 'PL!S-bp7-005',
  emma: 'PL!N-bp7-008',
  'festival-trio': 'LL-bp7-001',
  shizuku: 'PL!N-bp7-003',
  kinako: 'PL!SP-bp7-006',
  mei: 'PL!SP-bp7-007',
  maki: 'PL!-bp6-006',
  'hime-bp6': 'PL!HS-bp6-006',
  nico: 'PL!-pb2-018',
  kotori: 'PL!-bp6-003',
  riko: 'PL!S-bp6-002',
  nozomi: 'PL!-pb2-016',
  hanayo: 'PL!-pb2-017',
  mia: 'PL!N-bp7-011',
  rina: 'PL!N-bp8-009',
  umi: 'PL!-pb2-004',
  kanon: 'PL!SP-pb2-001',
  tomari: 'PL!SP-pb2-022',
  kasumi: 'PL!N-bp8-002',
  'nico-ai-seras': 'LL-bp8-001',
  kanan: 'PL!S-bp7-012',
  hanamaru: 'PL!S-bp7-016',
  keke: 'PL!SP-bp7-013',
  'sumire-pb2': 'PL!SP-pb2-026',
  yoshiko: 'PL!S-bp6-006',
  'maki-bp8': 'PL!-bp8-006',
  'dia-cl1': 'PL!S-cl1-004',
  'royal-trio': 'LL-bp6-001',
  mari: 'PL!S-bp6-008',
  kosuzu: 'PL!HS-bp6-013',
} as const;
export type EntranceAssetId = keyof typeof entranceCards;

/** Cosmetic manifest only: no ownership, quantities, card instances or deck order. */
export function collectEntranceAssetIds(cardCodes: Iterable<string>): EntranceAssetId[] {
  const codes = [...new Set(cardCodes)];
  return (Object.entries(entranceCards) as [EntranceAssetId, string][]).flatMap(([id, base]) =>
    codes.some(
      (code) =>
        code === base ||
        (code.startsWith(`${base}-`) && /^[^-]+$/.test(code.slice(base.length + 1)))
    )
      ? [id]
      : []
  );
}

export function isEntranceCard(code: string): boolean {
  return Object.values(entranceCards).some(
    (base) =>
      code === base || (code.startsWith(`${base}-`) && /^[^-]+$/.test(code.slice(base.length + 1)))
  );
}
/** Per-card budget: bounded asset loading + playback + transport margin. */
export const ENTRANCE_WAIT_LIMIT_MS = 6000;
/** Additional per-double-relay playback budget; ordinary entrances keep their existing limit. */
export const DOUBLE_RELAY_ENTRANCE_EXTRA_MS = 1400;
export const WAITING_RETURN_ENTRANCE_EXTRA_MS = 1300;
export const KAHO_RELAY_ENTRANCE_EXTRA_MS = 1600;
export const IZUMI_REPLAY_CARD_BASE = 'PL!HS-bp8-008';
export const IZUMI_REPLAY_ENTRANCE_EXTRA_MS = 1000;
export interface EntranceWait {
  readonly id: string;
  readonly cardIds: readonly string[];
  readonly waitingPlayerIds: readonly string[];
  readonly deadlineAt: number;
  /** Public nine-card set before shuffling, sorted independently of the hidden deck order. */
  readonly miraiReturn?: {
    readonly sourceCardId: string;
    readonly playerId: string;
    readonly members: readonly { readonly cardId: string; readonly cardCode: string }[];
    readonly targetMemberCardIds: readonly string[];
  };
  /** Successful exact-card exit/re-entry, already committed as one atomic effect. */
  readonly izumiReplay?: {
    readonly sourceCardId: string;
    readonly targetCardId: string;
    readonly playerId: string;
    readonly slot: SlotPosition;
    readonly previousOrientation: OrientationState;
  };
  /** Public scoring identities at the selected confirmation or ordered resolution boundary. */
  readonly bokuhikaSuccess?: {
    readonly sourceCardId: string;
    readonly normalizedNames: readonly string[];
    readonly scoreBonus: number;
  };
  /** A public member was stacked and its printed HEART successfully adopted. */
  readonly shizukuRole?: {
    readonly hostCardId: string;
    readonly sourceCardId: string;
    readonly hearts: readonly HeartIcon[];
  };
  /** Successful public LIVE movement commanded by the current Rina stage object. */
  readonly rinaLiveSwap?: {
    readonly hostCardId: string;
    readonly liveCardId: string;
    readonly liveCardCode: string;
    readonly playerId: string;
    readonly phase: 'RETURN' | 'PLACE';
    readonly liveIndex: number;
  };
  /** Resolved LIVE rewards before the existing public recovery selection. */
  readonly honokaMemory?: {
    readonly sourceCardId: string;
    readonly memoryCardIds: readonly string[];
    readonly part: 'rewards';
    readonly scoreGranted: boolean;
    readonly heartGranted: boolean;
    readonly recoveryReady: boolean;
  };
  /** Successful acquisition, after its discard cost and before invocation. */
  readonly abilityTransfer?: {
    readonly hostCardId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly grantId: string;
    readonly afterDiscard: boolean;
  };
  readonly kahoRelays?: readonly {
    readonly cardId: string;
    readonly source: {
      readonly cardId: string;
      readonly slot: SlotPosition;
      readonly orientation: OrientationState;
    };
  }[];
  /** Previously public members, sorted independently of the shuffled deck order. */
  readonly waitingRoomReturns?: readonly {
    readonly cardId: string;
    readonly playerId: string;
    readonly members: readonly { readonly cardId: string; readonly cardCode: string }[];
  }[];
  /** Only the replacements from these exact successful entry events, never inferred zone diffs. */
  readonly doubleRelays?: readonly {
    readonly cardId: string;
    readonly sources: readonly {
      readonly cardId: string;
      readonly slot: SlotPosition;
      readonly orientation: OrientationState;
    }[];
  }[];
}
export interface EntranceRuntime {
  readonly singleViewer: boolean;
  readonly seenSequence: number;
  readonly generation: number;
  readonly pending: EntranceWait | null;
  /** Authority-only continuation consumed once after ACK/timeout. */
  readonly continuation?: PendingAbilityState;
  /** Resume the completed workflow's pending-effect policy once after its presentation. */
  readonly resumePendingEffects?: boolean;
}
