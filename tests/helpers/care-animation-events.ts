import type { PlayerViewState } from '../../src/online';
import {
  createBattleAnimationEventsFromViewDiff,
  type BattleAnimationAnchorMaps,
} from '../../client/src/lib/battleAnimationEvents';
import { withCareMovementPresentation } from '../../client/src/lib/careMovementPresentation';

/** Distinct measured rectangles, populated only from this viewer's projection. */
export function careAnimationEvents(
  before: PlayerViewState,
  after: PlayerViewState,
  enabled = true
) {
  const anchors = (view: PlayerViewState): BattleAnimationAnchorMaps => ({
    cards: new Map(
      Object.keys(view.objects).map((id, i) => [
        id,
        { left: 20 + i * 15, top: 200, width: 70, height: 98 },
      ])
    ),
    zones: new Map(
      ['FIRST', 'SECOND'].flatMap((seat) =>
        ['hand', 'main-deck', 'inspection-zone', 'energy-zone', 'waiting-room'].map(
          (name, i) =>
            [
              `seat-${seat}::${name}`,
              { left: 200 + i * 100, top: seat === 'FIRST' ? 600 : 30, width: 90, height: 126 },
            ] as const
        )
      )
    ),
  });
  const previous = anchors(before),
    next = anchors(after);
  const ordinary = createBattleAnimationEventsFromViewDiff({
    previousViewState: before,
    nextViewState: after,
    previousAnchors: previous,
    nextAnchors: next,
  });
  return {
    ordinary,
    events: withCareMovementPresentation(before, after, ordinary, previous, next, enabled),
  };
}
