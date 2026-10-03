/** Public entrance identity shared by authority and cosmetic registry. */
export const entranceCards = {
  kanata: 'PL!N-bp7-006',
  ren: 'PL!SP-pb2-005',
  shiki: 'PL!SP-pb2-008',
  'next-step-trio': 'LL-bp2-001',
  hime: 'PL!HS-sd1-006',
  lanzhu: 'PL!N-bp1-012',
  eli: 'PL!-pb2-020',
  honoka: 'PL!-pb2-001',
  'rin-hanayo': 'PL!-pb2-000',
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
} as const;
export function isEntranceCard(code: string): boolean {
  return Object.values(entranceCards).some(
    (base) =>
      code === base || (code.startsWith(`${base}-`) && /^[^-]+$/.test(code.slice(base.length + 1)))
  );
}
/** Per-card budget: bounded asset loading + playback + transport margin. */
export const ENTRANCE_WAIT_LIMIT_MS = 6000;
export interface EntranceWait {
  readonly id: string;
  readonly cardIds: readonly string[];
  readonly waitingPlayerIds: readonly string[];
  readonly deadlineAt: number;
}
export interface EntranceRuntime {
  readonly disabled?: true;
  readonly singleViewer: boolean;
  readonly seenSequence: number;
  readonly generation: number;
  readonly pending: EntranceWait | null;
}
