import { create } from 'zustand';

const inFlight = new Set<string>();
export const useBattleCommandSubmission = create<{ pendingCount: number }>(() => ({
  pendingCount: 0,
}));

export function beginBattleCommandSubmission(identity: string): (() => void) | null {
  if (inFlight.has(identity)) return null;
  inFlight.add(identity);
  useBattleCommandSubmission.setState({ pendingCount: inFlight.size });
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    inFlight.delete(identity);
    useBattleCommandSubmission.setState({ pendingCount: inFlight.size });
  };
}

export function battleCommandIdentity(
  matchId: string,
  seat: string | undefined,
  command: object
): string {
  // Retries carry fresh timestamps; these must not turn a double click into another operation.
  return JSON.stringify([matchId, seat, command], (key, value: unknown) =>
    key === 'timestamp' || key === 'idempotencyKey' || key === 'commandId' ? undefined : value
  );
}
