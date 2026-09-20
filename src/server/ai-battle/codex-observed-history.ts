import type { AiDecisionInput } from './protocol.js';
import type { PublicEvent } from '../../online/types.js';

// Leave room for frozen knowledge and the current observation in the 512 KiB request cap.
export const CODEX_OBSERVED_HISTORY_MAX_BYTES = 256 * 1024;

export class CodexObservedHistoryCapacityError extends Error {
  readonly limitBytes = CODEX_OBSERVED_HISTORY_MAX_BYTES;

  constructor(readonly attemptedBytes: number) {
    super('Observed history capacity reached');
    this.name = 'CodexObservedHistoryCapacityError';
  }
}

/** Only already-projected events received by this client. Never query authority or another seat. */
export class CodexObservedHistory {
  private events = new Map<number, PublicEvent>();
  private matchId?: string;
  private seat?: string;
  private through = 0;
  private bytes = 0;

  observe(input: AiDecisionInput): void {
    if (this.seat && this.seat !== input.state.selfSeat) throw new Error('History seat changed');
    const history = input.history;
    if (!history || history.throughPublicSeq < this.through)
      throw new Error('History unavailable or rewound');
    // Validate the whole batch before committing events, byte accounting or identity.
    const additions = new Map<number, PublicEvent>();
    let matchId = this.matchId;
    let bytes = this.bytes;
    for (const event of history.events) {
      if (event.seq > history.throughPublicSeq || !Number.isSafeInteger(event.seq) || event.seq < 1)
        throw new Error('Invalid public event sequence');
      if (matchId && event.matchId !== matchId) throw new Error('History match changed');
      matchId = event.matchId;
      const encoded = JSON.stringify(event);
      const previous = this.events.get(event.seq) ?? additions.get(event.seq);
      if (previous) {
        if (JSON.stringify(previous) !== encoded) throw new Error('Public history changed');
        continue;
      }
      bytes += Buffer.byteLength(encoded);
      if (bytes > CODEX_OBSERVED_HISTORY_MAX_BYTES)
        throw new CodexObservedHistoryCapacityError(bytes);
      additions.set(event.seq, globalThis.structuredClone(event));
    }
    for (const [seq, event] of additions) this.events.set(seq, event);
    this.seat = input.state.selfSeat;
    this.matchId = matchId;
    this.bytes = bytes;
    this.through = history.throughPublicSeq;
  }

  handover() {
    const events = [...this.events.values()].sort((a, b) => a.seq - b.seq);
    const observedRanges: number[][] = [];
    for (const event of events) {
      const last = observedRanges.at(-1);
      if (last && last[1] + 1 === event.seq) last[1] = event.seq;
      else observedRanges.push([event.seq, event.seq]);
    }
    return globalThis.structuredClone({
      source: 'PUBLIC_EVENTS_PREVIOUSLY_DELIVERED_TO_THIS_SEAT',
      // Sampling may miss events. Historical identities never prove current hidden positions.
      complete: false,
      throughPublicSeq: this.through,
      observedRanges,
      unobservedEventCount: this.through - events.length,
      events,
    });
  }
}
