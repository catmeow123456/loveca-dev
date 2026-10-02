/** Public entrance identity shared by authority and cosmetic registry. */
export const entranceCards = {
  kanata: 'PL!N-bp7-006',
  ren: 'PL!SP-pb2-005',
  shiki: 'PL!SP-pb2-008',
  'next-step-trio': 'LL-bp2-001',
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
  readonly singleViewer: boolean;
  readonly seenSequence: number;
  readonly generation: number;
  readonly pending: EntranceWait | null;
}
