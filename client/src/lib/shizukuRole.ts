import type { PlayerViewState } from '@game/online/types';
import { isShizukuSec } from '@game/shared/card-entrance';
import { getEntranceStageTarget, getLandingCardGeometry } from './cardEntranceLanding';
import type { BattleAnimationRect } from './battleAnimationEvents';
import type { OrientationState } from '@game/shared/types/enums';

export const shizukuTiming = { role: 1840, reduced: 240, stackReveal: 1590 } as const;
export const roleProgress = (time: number, start: number, duration: number) => {
  const p = Math.max(0, Math.min(1, (time - start) / duration));
  return p * p * (3 - 2 * p);
};

/** Only the successful authority window and its already-public member can supply the role. */
export function getShizukuRole(view: PlayerViewState, imagePath: (code: string) => string) {
  const role = view.match.entrance?.shizukuRole;
  if (!role) return undefined;
  const target = getEntranceStageTarget(view, role.hostObjectId);
  const source = view.objects[role.sourceObjectId];
  if (!target || !isShizukuSec(target.cardCode) || source?.surface !== 'FRONT' || !source.frontInfo)
    return undefined;
  return {
    ...role,
    target,
    name: source.frontInfo.nameCn || source.frontInfo.nameJp || '',
    imagePath: imagePath(source.frontInfo.cardCode),
    side: source.ownerSeat === view.match.viewerSeat ? ('self' as const) : ('opponent' as const),
  };
}
export type ShizukuRole = NonNullable<ReturnType<typeof getShizukuRole>>;

/** This is the rendered under-card, including its real pile offset and border. */
export function getShizukuStackElement(objectId: string) {
  return document.querySelector<HTMLElement>(
    `[data-battle-stacked-member="${CSS.escape(objectId)}"] .battle-card-face`
  );
}

/** The upper image and actual under-card share one pose during their 100ms handoff. */
export function getShizukuStackFrame(
  member: BattleAnimationRect,
  stacked: BattleAnimationRect,
  orientation: OrientationState,
  elapsed: number
) {
  const card = getLandingCardGeometry(member, orientation);
  const sink = roleProgress(elapsed, 1490, 300);
  const mix = (a: number, b: number) => a + (b - a) * sink;
  return {
    sink,
    x: mix(card.x, stacked.left + stacked.width / 2),
    y: mix(card.y, stacked.top + stacked.height / 2),
    width: mix(card.width, stacked.width),
    height: mix(card.height, stacked.height),
    // Under-members are rendered upright, even when the main member is waiting.
    rotation: mix(card.rotation, 0),
    opacity: roleProgress(elapsed, shizukuTiming.stackReveal, 100),
  };
}
