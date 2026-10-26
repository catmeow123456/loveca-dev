import type { ActiveEffectViewState, ViewCardObject } from '@game/online/types';

export function getActiveEffectVisibilityLabel(
  effect:
    Pick<ActiveEffectViewState, 'inspectionObjectIds' | 'revealedObjectIds'> | null | undefined,
  objects: Readonly<Record<string, Pick<ViewCardObject, 'publiclyRevealed'>>>
): string | null {
  const inspectedIds = effect?.inspectionObjectIds ?? [];
  const revealedIds = new Set(effect?.revealedObjectIds ?? []);
  // Inspection bookkeeping can retain public cards after the reveal display ends.
  for (const objectId of inspectedIds) {
    if (objects[objectId]?.publiclyRevealed) revealedIds.add(objectId);
  }
  const privateCount = inspectedIds.filter((objectId) => !revealedIds.has(objectId)).length;
  if (revealedIds.size > 0) {
    return privateCount > 0
      ? `未公开 ${privateCount} 张 · 公开 ${revealedIds.size} 张`
      : `公开 ${revealedIds.size} 张`;
  }
  if (privateCount > 0) return `检视 ${privateCount} 张`;
  return null;
}
