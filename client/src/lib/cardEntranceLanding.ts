import type { PlayerViewState } from '@game/online';
import { OrientationState, ZoneType } from '@game/shared/types/enums';
import type { BattleAnimationRect } from './battleAnimationEvents';
import { isKanataEntranceCode } from './cardEntranceEvents';

export const CARD_ENTRANCE_LANDING_DELAY_MS = 1750;
export const CARD_ENTRANCE_TRAVEL_MS = 400;
export const CARD_ENTRANCE_FLIGHT_MS = CARD_ENTRANCE_TRAVEL_MS + 150;
export const CARD_ENTRANCE_IMPACT_MS = 440;
export const CARD_ENTRANCE_TOTAL_MS =
  CARD_ENTRANCE_LANDING_DELAY_MS + CARD_ENTRANCE_FLIGHT_MS + CARD_ENTRANCE_IMPACT_MS;

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
  if (!view || object?.surface !== 'FRONT' || !code || !isKanataEntranceCode(code)) return null;
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
