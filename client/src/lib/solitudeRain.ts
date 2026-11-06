import type { PlayerViewState } from '@game/online/types';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';
import { ZoneType } from '@game/shared/types/enums';
import { getPublicStageMemberTarget, type EntranceStageTarget } from './cardEntranceLanding';
import { HEART_ICON_SOURCE_BY_COLOR } from './modifierIconAssets';

export const SOLITUDE_RAIN_DURATION = 1900;
export const SOLITUDE_RAIN_HEART_AT = 1260;
export const SOLITUDE_RAIN_SCORE_AT = 1520;
export interface SolitudeRainPresentation {
  sourceObjectId: string;
  target: EntranceStageTarget;
  convertedHeartCount: number;
  scoreBonus: number;
}
/** All outcomes come from the completed workflow, including zero and pre-existing purple Hearts. */
export function getSolitudeRain(view: PlayerViewState): SolitudeRainPresentation | null {
  const cue = view.match.entrance?.solitudeRain;
  const song = cue && view.objects[cue.sourceObjectId];
  const target = cue && getPublicStageMemberTarget(view, cue.targetObjectId);
  if (
    !cue ||
    !target ||
    song?.surface !== 'FRONT' ||
    !song.frontInfo ||
    !cardCodeMatchesBase(song.frontInfo.cardCode, 'PL!N-bp8-026')
  )
    return null;
  return {
    sourceObjectId: cue.sourceObjectId,
    target,
    convertedHeartCount: cue.convertedHeartCount,
    scoreBonus: cue.scoreBonus,
  };
}
/** A visible song warms only the standard feedback icon. No member textures are requested. */
export function solitudeRainPreloadUrls(view: PlayerViewState): string[] {
  const publicSong = Object.values(view.table.zones).some(
    (z) =>
      [ZoneType.LIVE_ZONE, ZoneType.WAITING_ROOM, ZoneType.SUCCESS_ZONE].some(
        (type) => z.zone === type
      ) &&
      z.objectIds?.some((id) => {
        const o = view.objects[id];
        return (
          o?.surface === 'FRONT' &&
          o.frontInfo &&
          cardCodeMatchesBase(o.frontInfo.cardCode, 'PL!N-bp8-026')
        );
      })
  );
  return publicSong ? [HEART_ICON_SOURCE_BY_COLOR.PURPLE] : [];
}
