import type { PlayerViewState } from '@game/online/types';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';
import {
  bokuhikaContributionFromNames,
  bokuhikaSuccessCueKey,
} from '@/components/game/song-animation/bokuhikaCast';

/** Consume the authority's public cue, never infer contributors from client zones or a registry. */
export function getBokuhikaPresentation(view: PlayerViewState) {
  const cue = view.match.entrance?.bokuhikaSuccess;
  if (!cue) return null;
  // Ordered auto-resolution has no confirmation panel; only an authority cue can present it.
  if (view.activeEffect && !bokuhikaSuccessCueKey(view.activeEffect)) return null;
  const source = view.objects[cue.sourceObjectId];
  if (
    (view.activeEffect && cue.sourceObjectId !== view.activeEffect.sourceObjectId) ||
    source?.surface !== 'FRONT' ||
    !source.frontInfo ||
    !cardCodeMatchesBase(source.frontInfo.cardCode, 'PL!-pb2-039')
  )
    return null;
  return bokuhikaContributionFromNames(cue.normalizedNames, cue.scoreBonus);
}
