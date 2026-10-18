import type { PlayerViewState } from '@game/online/types';
import { OrientationState, type SlotPosition } from '@game/shared/types/enums';

/** The last 260 ms blend the formed card into the existing portrait entrance. */
export const doubleRelayTimeline = {
  charge: 220,
  dissolve: 180,
  travel: 560,
  mergeAt: 960,
  formAt: 1120,
  portraitAt: 1220,
  end: 1480,
} as const;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
export function doubleRelayFrame(elapsed: number) {
  const t = doubleRelayTimeline;
  const charge = smooth(elapsed / t.charge);
  const dissolve = smooth((elapsed - t.charge) / t.dissolve);
  const travel = smooth((elapsed - t.charge - t.dissolve) / t.travel);
  const merge = smooth((elapsed - t.mergeAt) / (t.formAt - t.mergeAt));
  const form = smooth((elapsed - t.formAt) / 160);
  const fade = 1 - smooth((elapsed - t.portraitAt) / (t.end - t.portraitAt));
  return {
    charge,
    dissolve,
    travel,
    merge,
    form,
    fade,
    phase:
      elapsed < t.charge
        ? 'charge'
        : elapsed < t.mergeAt
          ? 'rising'
          : elapsed < t.formAt
            ? 'merge'
            : 'formed',
    finished: elapsed >= t.end,
  };
}
export interface DoubleRelaySource {
  objectId: string;
  cardCode: string;
  slot: SlotPosition;
  side: 'self' | 'opponent';
  orientation: OrientationState;
  imagePath: string;
}
/** Only actual double-relay metadata plus currently public faces may create light sources. */
export function getDoubleRelaySources(
  view: PlayerViewState,
  objectId: string,
  imagePath: (code: string) => string
): readonly DoubleRelaySource[] {
  const relay = view.match.entrance?.doubleRelays?.find((entry) => entry.objectId === objectId);
  if (relay?.sources.length !== 2 || new Set(relay.sources.map((s) => s.objectId)).size !== 2)
    return [];
  const sources = relay.sources.flatMap((source) => {
    const object = view.objects[source.objectId];
    const code = object?.frontInfo?.cardCode;
    return object?.surface === 'FRONT' && code
      ? [
          {
            ...source,
            cardCode: code,
            side:
              object.ownerSeat === view.match.viewerSeat
                ? ('self' as const)
                : ('opponent' as const),
            orientation: source.orientation,
            imagePath: imagePath(code),
          },
        ]
      : [];
  });
  return sources.length === 2 ? sources : [];
}
export interface RelayPoint {
  x: number;
  y: number;
}
/** A short upward release followed by two separated arcs into the stage centre. */
export function relayBeamPoint(
  start: RelayPoint,
  end: RelayPoint,
  side: number,
  progress: number
): RelayPoint {
  const t = clamp(progress),
    u = 1 - t;
  const bow = Math.min(180, Math.max(55, Math.abs(end.y - start.y) * 0.65));
  const c1 = { x: start.x + side * bow, y: start.y - bow };
  const c2 = { x: end.x + side * bow * 0.65, y: end.y - bow * 0.55 };
  return {
    x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
    y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
  };
}
