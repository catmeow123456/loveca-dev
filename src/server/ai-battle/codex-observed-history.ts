import type { AiDecisionInput } from './protocol.js';
import type { PublicEvent } from '../../online/types.js';

/** Only already-projected events received by this client. Never query authority or another seat. */
export class CodexObservedHistory {
  private events = new Map<number, PublicEvent>();
  private matchId?: string;
  private seat?: string;
  private through = 0;
  private bytes = 0;

  observe(input: AiDecisionInput): void {
    if (this.seat && this.seat !== input.state.selfSeat) throw new Error('History seat changed');
    this.seat = input.state.selfSeat;
    const history = input.history;
    if (!history || history.throughPublicSeq < this.through)
      throw new Error('History unavailable or rewound');
    for (const event of history.events) {
      if (event.seq > history.throughPublicSeq || !Number.isSafeInteger(event.seq) || event.seq < 1)
        throw new Error('Invalid public event sequence');
      if (this.matchId && event.matchId !== this.matchId) throw new Error('History match changed');
      this.matchId = event.matchId;
      const encoded = JSON.stringify(event);
      const previous = this.events.get(event.seq);
      if (previous) {
        if (JSON.stringify(previous) !== encoded) throw new Error('Public history changed');
        continue;
      }
      this.bytes += Buffer.byteLength(encoded);
      if (this.bytes > 128 * 1024) throw new Error('Observed history capacity reached');
      this.events.set(event.seq, structuredClone(event));
    }
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
    return structuredClone({
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
