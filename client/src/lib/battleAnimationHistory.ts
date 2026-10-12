import type { BattleAnimationEvent } from './battleAnimationEvents';

interface AnimationCursor {
  readonly matchId: string;
  readonly viewerSeat: string;
  readonly seq: number;
  readonly presentationEpoch?: number;
  readonly isReadOnly?: boolean;
}

/** Deduplicate within one forward timeline; an undo starts a new presentation identity. */
export function createBattleAnimationHistory() {
  let cursor: AnimationCursor | null = null;
  let generation = 0;
  const seen = new Set<string>();
  return {
    sync(next: AnimationCursor | null): boolean {
      const reset =
        cursor?.matchId !== next?.matchId ||
        cursor?.viewerSeat !== next?.viewerSeat ||
        cursor?.isReadOnly !== next?.isReadOnly ||
        !!(
          cursor &&
          next &&
          (next.seq < cursor.seq ||
            (cursor.presentationEpoch !== undefined &&
              next.presentationEpoch !== undefined &&
              cursor.presentationEpoch !== next.presentationEpoch))
        );
      if (reset) {
        seen.clear();
        generation++;
      }
      cursor = next;
      return reset;
    },
    accept(events: readonly BattleAnimationEvent[]): BattleAnimationEvent[] {
      const fresh: BattleAnimationEvent[] = [];
      for (const event of events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        // Old completion callbacks/React exit children cannot match a redo's event.
        fresh.push({ ...event, id: `timeline-${generation}:${event.id}` });
      }
      if (seen.size > 200) {
        const keep = [...seen].slice(-150);
        seen.clear();
        keep.forEach((id) => seen.add(id));
      }
      return fresh;
    },
  };
}
