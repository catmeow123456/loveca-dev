import type { PlayerViewState } from '@game/online';
import { OrientationState, ZoneType } from '@game/shared/types/enums';
import type { BattleAnimationRect } from './battleAnimationEvents';
import { getCardEntranceProfile } from './cardEntranceProfiles';

export interface EntranceStageTarget {
  objectId: string;
  cardCode: string;
  locationKey: string;
  orientation: OrientationState;
}

/** Only current, public, top-level stage occupants can own a landing presentation. */
export function getEntranceStageTarget(
  view: PlayerViewState | null,
  objectId: string
): EntranceStageTarget | null {
  const object = view?.objects[objectId];
  const code = object?.frontInfo?.cardCode;
  if (!view || object?.surface !== 'FRONT' || !code || !getCardEntranceProfile(code)) return null;
  for (const [zoneKey, zone] of Object.entries(view.table.zones)) {
    if (zone.zone !== ZoneType.MEMBER_SLOT) continue;
    for (const [slot, occupant] of Object.entries(zone.slotMap ?? {})) {
      if (occupant === objectId) {
        return {
          objectId,
          cardCode: code,
          locationKey: `${zoneKey}:${slot}`,
          orientation: object.orientation ?? OrientationState.ACTIVE,
        };
      }
    }
  }
  return null;
}

export function sameEntranceTarget(a: EntranceStageTarget, b: EntranceStageTarget | null) {
  return (
    !!b &&
    a.objectId === b.objectId &&
    a.cardCode === b.cardCode &&
    a.locationKey === b.locationKey &&
    a.orientation === b.orientation
  );
}

/** DOM bounds already contain the quarter turn of a waiting member. */
export function getLandingCardGeometry(rect: BattleAnimationRect, orientation: OrientationState) {
  const waiting = orientation === OrientationState.WAITING;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: waiting ? rect.height : rect.width,
    height: waiting ? rect.width : rect.height,
    rotation: waiting ? 90 : 0,
  };
}

/** The edge facing the impact rises; convert screen direction into the card's resting axes. */
export function getNeighborImpactHinge(
  towardX: number,
  towardY: number,
  rotation: number,
  width: number,
  height: number
) {
  const radians = (rotation * Math.PI) / 180;
  const localX = towardX * Math.cos(radians) + towardY * Math.sin(radians);
  const localY = -towardX * Math.sin(radians) + towardY * Math.cos(radians);
  const length = Math.hypot(localX, localY);
  if (length < 0.001) return null;
  const x = Math.abs(localX / length) < 0.001 ? 0 : localX / length;
  const y = Math.abs(localY / length) < 0.001 ? 0 : localY / length;
  return {
    pivotX: (-Math.sign(x) * width) / 2,
    pivotY: (-Math.sign(y) * height) / 2,
    axisX: y,
    axisY: -x,
  };
}

/** Decorative light stays local; tabletop motion has its own wider reach. */
export function getLandingImpactRadius(cardSize: number) {
  return cardSize * 1.45;
}
export function getLandingSpreadProgress(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return 1 - (1 - t) ** 3;
}
export function getNeighborImpactResponse(distance: number, radius: number, variation: number) {
  const d = Math.max(0, distance / Math.max(1, radius));
  if (d >= 1) return null;
  const strength = (1 - d * 0.8) * (0.78 + variation * 0.44);
  return {
    strength,
    angle: Math.min(46, (36 + variation * 12) * (0.65 + strength * 0.35)),
    // Mechanical impulse propagates beyond the decorative light.
    arrival: d,
  };
}

/** One height curve for the card, its perspective and its contact shadow. */
export function getLandingFlightFrame(elapsed: number, travel: number, press: number) {
  const t = Math.max(0, Math.min(1, elapsed / travel));
  const path = t * t * (3 - 2 * t);
  const descent = Math.max(0, Math.min(1, (elapsed - travel) / press));
  return { path, height: 1 - descent ** 2, finished: elapsed >= travel + press };
}
