import type {
  EffectFeedbackChange,
  EffectFeedbackPublicEvent,
  EffectFeedbackTarget,
  PlayerViewState,
} from '@game/online';
import { FaceState } from '@game/shared/types/enums';

/** Only an individual public event is grouped. Opposite signs remain distinct. */
export function groupEffectFeedbackChanges(
  changes: readonly EffectFeedbackChange[]
): EffectFeedbackChange[] {
  const groups = new Map<string, EffectFeedbackChange>();
  for (const change of changes) {
    if ('delta' in change && change.delta === 0) continue;
    const key = `${change.kind}:${'color' in change ? change.color : ''}:${Math.sign(change.delta)}`;
    const previous = groups.get(key);
    groups.set(
      key,
      previous && 'delta' in previous && 'delta' in change
        ? { ...change, delta: previous.delta + change.delta }
        : { ...change }
    );
  }
  return [...groups.values()];
}
export function effectFeedbackTargetKey(target: EffectFeedbackTarget): string {
  return target.objectId ? `card:${target.objectId}` : `zone:${target.zoneKey}`;
}
export function isEffectFeedbackTargetCurrent(
  target: EffectFeedbackTarget,
  view: PlayerViewState
): boolean {
  const zone = view.table.zones[target.zoneKey];
  if (!zone) return false;
  if (!target.objectId) return true;
  const card = view.objects[target.objectId];
  return (
    card?.surface === 'FRONT' &&
    card.faceState === FaceState.FACE_UP &&
    [...(zone.objectIds ?? []), ...Object.values(zone.slotMap ?? {})].includes(target.objectId)
  );
}
export interface FeedbackPresentation {
  readonly id: string;
  readonly key: string;
  readonly event: EffectFeedbackPublicEvent;
  readonly target: EffectFeedbackTarget;
  readonly source: boolean;
  readonly startedAt: number;
  readonly endsAt: number;
}
/** New results immediately replace the same target; unrelated targets keep playing. */
export function replaceFeedbackPresentations<T extends FeedbackPresentation>(
  current: readonly T[],
  additions: readonly T[]
) {
  const items = new Map(current.map((item) => [item.key, item]));
  for (const item of additions) items.set(item.key, item);
  return [...items.values()];
}
