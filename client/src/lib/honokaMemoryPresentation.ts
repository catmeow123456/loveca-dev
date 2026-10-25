import type { PlayerViewState } from '@game/online/types';
import { getEntranceStageTarget } from './cardEntranceLanding';
import {
  hasMemoryPresentation,
  supportsHonokaMemory,
  type HonokaMemoryCue,
  type MemoryCardFace,
} from '@/components/game/card-entrance/honoka-memory-stage/honokaMemoryTimeline';

/** Current authority window only. Never infer rewards from modifiers or read a hidden hand. */
export function getHonokaMemoryPresentation(
  view: PlayerViewState,
  imagePath: (code: string) => string
) {
  const wait = view.match.entrance;
  const memory = wait?.honokaMemory;
  if (!wait || !memory) return undefined;
  const target = getEntranceStageTarget(view, memory.sourceObjectId);
  if (!target || !supportsHonokaMemory(target.cardCode)) return undefined;
  const face = (objectId: string): MemoryCardFace | undefined => {
    const object = view.objects[objectId];
    const info = object?.surface === 'FRONT' ? object.frontInfo : undefined;
    return info
      ? {
          objectId,
          code: info.cardCode,
          name: info.nameCn || info.nameJp || info.cardCode,
          image: imagePath(info.cardCode),
          landscape: info.cardType === 'LIVE',
        }
      : undefined;
  };
  const source = face(memory.sourceObjectId);
  if (!source) return undefined;
  const cue: HonokaMemoryCue = {
    id: wait.id,
    source,
    part: memory.part,
    memories: memory.memoryObjectIds.flatMap((id) => {
      const card = face(id);
      return card ? [card] : [];
    }),
    scoreGranted: memory.scoreGranted,
    heartGranted: memory.heartGranted,
    recoveryReady: memory.recoveryReady,
  };
  return hasMemoryPresentation(cue)
    ? {
        cue,
        target,
        side:
          view.objects[memory.sourceObjectId]!.ownerSeat === view.match.viewerSeat
            ? ('self' as const)
            : ('opponent' as const),
      }
    : undefined;
}
export type HonokaMemoryPresentation = NonNullable<ReturnType<typeof getHonokaMemoryPresentation>>;
