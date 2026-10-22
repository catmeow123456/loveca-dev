import type { EntranceStageTarget } from '@/lib/cardEntranceLanding';
import { OrientationState } from '@game/shared/types/enums';
import {
  getBattleDeckAnchor,
  getBattleLiveZoneAnchor,
  getBattleWaitingRoomAnchor,
} from '@/lib/battleUiAnchors';
import type { Rect, RinaSecLayout } from './rinaSecDrawing';

const rect = (element: Element | null): Rect | null => {
  const r = element?.getBoundingClientRect();
  return r?.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
};
const anchor = (name: string) =>
  document.querySelector<HTMLElement>(`[data-battle-ui-anchor="${name}"]`);

/** Geometry comes from the rendered seat and exact public slot, including narrow/opponent layouts. */
export function readRinaBattleLayout(
  target: EntranceStageTarget,
  side: 'self' | 'opponent',
  liveIndex?: number
): RinaSecLayout | null {
  const board = rect(anchor('battle-board'));
  const member = rect(
    document.querySelector(
      `[data-battle-ui-anchor*="-stage-"] [data-object-id="${CSS.escape(target.objectId)}"]`
    )
  );
  if (!board || !member) return null;
  const common = {
    board,
    member,
    side,
    memberRotation: target.orientation === OrientationState.WAITING ? Math.PI / 2 : 0,
  };
  if (liveIndex === undefined) return { ...common, live: member, deck: member, waiting: member };
  const slot = anchor(getBattleLiveZoneAnchor(side))?.querySelector<HTMLElement>(
    `[data-battle-live-slot="${liveIndex}"]`
  );
  const bounds = rect(slot ?? null);
  const deck = rect(
    anchor(getBattleDeckAnchor(side, 'main'))?.querySelector('[data-animation-zone-id]') ?? null
  );
  const waiting = rect(
    anchor(getBattleWaitingRoomAnchor(side))?.querySelector('[data-animation-zone-id]') ?? null
  );
  if (!slot || !bounds || !deck || !waiting) return null;
  // Empty slots still need the exact computed card dimensions. This inert probe avoids
  // sampling Framer's mounting scale and never changes React's existing card or slot.
  const probe = document.createElement('span');
  Object.assign(probe.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: 'var(--battle-live-width)',
    height: 'var(--battle-live-height)',
  });
  slot.appendChild(probe);
  const size = rect(probe);
  probe.remove();
  if (!size) return null;
  return {
    ...common,
    live: {
      x: bounds.x + (bounds.width - size.width) / 2,
      y: bounds.y + (bounds.height - size.height) / 2,
      width: size.width,
      height: size.height,
    },
    deck,
    waiting,
  };
}
