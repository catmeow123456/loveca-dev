import type { SlotPosition, OrientationState } from './types/enums.js';
import type { PendingAbilityState } from '../domain/entities/game.js';

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
export interface EntranceWait {
  readonly id: string;
  readonly cardIds: readonly string[];
  readonly waitingPlayerIds: readonly string[];
  readonly deadlineAt: number;
  /** Successful public LIVE movement commanded by the current Rina stage object. */
  readonly rinaLiveSwap?: {
    readonly hostCardId: string;
    readonly liveCardId: string;
    readonly liveCardCode: string;
    readonly playerId: string;
    readonly phase: 'RETURN' | 'PLACE';
    readonly liveIndex: number;
  };
  /** Resolved LIVE rewards, or an already-public card successfully recovered to hand. */
  readonly honokaMemory?: {
    readonly sourceCardId: string;
    readonly memoryCardIds: readonly string[];
    readonly part: 'rewards' | 'recovery';
    readonly scoreGranted: boolean;
    readonly heartGranted: boolean;
    readonly recoveryReady: boolean;
    readonly recovered?: {
      readonly cardId: string;
      readonly cardCode: string;
      readonly name: string;
      readonly landscape: boolean;
    };
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
