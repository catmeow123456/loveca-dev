import type { PlayerViewState } from '@game/online';
import { OrientationState, ZoneType } from '@game/shared/types/enums';
import type { PublicDiscardRevealBatch } from './publicDiscardRevealQueue';
import { getCareEffectCues } from './kotoriAyumuEffects';
import type {
  BattleAnimationAnchorMaps,
  BattleAnimationEvent,
  BattleAnimationRect,
} from './battleAnimationEvents';

export type CareMovementKind = 'KOTORI_KEEP' | 'AYUMU_GIVE' | 'AYUMU_RETURN' | 'AYUMU_DRAW';
export const CARE_MOVE_MS: Record<CareMovementKind, number> = {
  KOTORI_KEEP: 720,
  AYUMU_GIVE: 720,
  AYUMU_RETURN: 680,
  AYUMU_DRAW: 360,
};
export interface CareWindowGate {
  eventId: string;
  effectId: string;
  stepId: string;
  ownerSeat: 'FIRST' | 'SECOND';
  fromSeq: number;
  toSeq: number;
  kind: 'KOTORI_INSPECT' | 'AYUMU_RETURN';
}
export function getCareWindowGate(
  before: PlayerViewState | null,
  after: PlayerViewState | null
): CareWindowGate | null {
  const cue = getCareEffectCues(before, after).find(
    (c) => c.kind === 'KOTORI_INSPECT' || c.kind === 'AYUMU_RETURN'
  );
  if (!cue || !after?.activeEffect || !before) return null;
  return {
    eventId: `care-window:${cue.key}`,
    effectId: after.activeEffect.id,
    stepId: after.activeEffect.stepId,
    ownerSeat: cue.ownerSeat,
    fromSeq: before.match.seq,
    toSeq: after.match.seq,
    kind: cue.kind as CareWindowGate['kind'],
  };
}
/** Public event sequences are the view's authority sequence, including late log slices. */
export function matchesCareDiscardGate(
  gate: CareWindowGate | null,
  batch: PublicDiscardRevealBatch
): boolean {
  return (
    gate?.kind === 'KOTORI_INSPECT' &&
    batch.ownerSeat === gate.ownerSeat &&
    batch.firstSeq > gate.fromSeq &&
    batch.lastSeq <= gate.toSeq
  );
}
const zone = (v: PlayerViewState, seat: string, type: ZoneType) =>
  Object.values(v.table.zones).find((z) => z.ownerSeat === seat && z.zone === type);

/** Energy anchors are painted bounding boxes; restore a portrait box before rotating. */
function energyPose(rect: BattleAnimationRect, waiting: boolean): BattleAnimationRect {
  if (!waiting) return rect;
  const height = Math.max(rect.width, rect.height),
    width = (height * 5) / 7;
  return {
    left: rect.left + rect.width / 2 - width / 2,
    top: rect.top + rect.height / 2 - height / 2,
    width,
    height,
    rotation: 90,
  };
}

/** One physical flight per successful movement. Unknown hand identities stay anonymous backs. */
export function withCareMovementPresentation(
  before: PlayerViewState,
  after: PlayerViewState,
  events: readonly BattleAnimationEvent[],
  previous: BattleAnimationAnchorMaps,
  next: BattleAnimationAnchorMaps,
  enabled: boolean
): BattleAnimationEvent[] {
  if (!enabled) return [...events];
  const cues = getCareEffectCues(before, after);
  if (!cues.length) return [...events];
  const additions: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>[] = [];
  for (const cue of cues) {
    const seat = cue.ownerSeat;
    const oldZone = (name: string) => previous.zones.get(`seat-${seat}::${name}`);
    const newZone = (name: string) => next.zones.get(`seat-${seat}::${name}`);
    const add = (
      kind: CareMovementKind,
      id: string,
      fromRect: BattleAnimationRect | undefined,
      toRect: BattleAnimationRect | undefined,
      fromZoneType: ZoneType,
      toZoneType: ZoneType,
      delayMs = 0,
      receiverId?: string
    ) => {
      if (!fromRect || !toRect) return;
      const card = after.objects[id];
      const visible = card?.surface === 'FRONT' ? card.frontInfo : undefined;
      additions.push({
        id: `care-move:${after.match.seq}:${kind}:${id}`,
        kind: 'CARD_MOVE',
        render: {
          objectId: id,
          cardId: '',
          surface: visible ? 'FRONT' : 'BACK',
          fromSurface: visible ? 'FRONT' : 'BACK',
          toSurface: visible ? 'FRONT' : 'BACK',
          cardCode: visible?.cardCode,
          name: visible?.nameCn ?? visible?.nameJp,
        },
        fromRect:
          fromZoneType === ZoneType.ENERGY_ZONE && previous.cards.has(id)
            ? energyPose(fromRect, before.objects[id]?.orientation === OrientationState.WAITING)
            : fromRect,
        toRect:
          toZoneType === ZoneType.ENERGY_ZONE && next.cards.has(id)
            ? energyPose(toRect, card?.orientation === OrientationState.WAITING)
            : toRect,
        fromZoneType,
        toZoneType,
        toSeat: seat,
        careMovement: {
          kind,
          delayMs,
          receiver:
            receiverId && next.cards.has(receiverId)
              ? { objectId: receiverId, rect: next.cards.get(receiverId)! }
              : undefined,
        },
        anonymousHandSeat: !card && toZoneType === ZoneType.HAND ? seat : undefined,
      });
    };
    if (cue.kind === 'KOTORI_KEEP') {
      const kept = (zone(after, seat, ZoneType.HAND)?.objectIds ?? []).find((id) =>
        before.activeEffect?.inspectionObjectIds?.includes(id)
      );
      const id = kept ?? `care-hidden-hand:${seat}:${after.match.seq}`;
      add(
        'KOTORI_KEEP',
        id,
        (kept ? previous.cards.get(kept) : undefined) ??
          oldZone('inspection-zone') ??
          oldZone('main-deck'),
        (kept ? next.cards.get(kept) : undefined) ?? newZone('hand'),
        ZoneType.INSPECTION_ZONE,
        ZoneType.HAND
      );
    }
    for (const target of cue.targets) {
      if (cue.kind === 'AYUMU_GIVE')
        add(
          'AYUMU_GIVE',
          target.energyId,
          previous.cards.get(target.energyId) ?? oldZone('energy-zone'),
          next.cards.get(target.energyId) ?? next.cards.get(target.memberId),
          ZoneType.ENERGY_ZONE,
          ZoneType.MEMBER_SLOT,
          0,
          target.memberId
        );
      if (cue.kind === 'AYUMU_RETURN')
        add(
          'AYUMU_RETURN',
          target.energyId,
          previous.cards.get(target.energyId) ?? previous.cards.get(target.memberId),
          next.cards.get(target.energyId) ?? newZone('energy-zone'),
          ZoneType.MEMBER_SLOT,
          ZoneType.ENERGY_ZONE
        );
    }
    if (cue.kind === 'AYUMU_RETURN') {
      const oldHand = zone(before, seat, ZoneType.HAND),
        newHand = zone(after, seat, ZoneType.HAND);
      if ((newHand?.count ?? 0) > (oldHand?.count ?? 0)) {
        const drawn = newHand?.objectIds?.find((id) => !oldHand?.objectIds?.includes(id));
        add(
          'AYUMU_DRAW',
          drawn ?? `care-hidden-hand:${seat}:${after.match.seq}`,
          oldZone('main-deck'),
          (drawn ? next.cards.get(drawn) : undefined) ?? newZone('hand'),
          ZoneType.MAIN_DECK,
          ZoneType.HAND,
          CARE_MOVE_MS.AYUMU_RETURN
        );
      }
      const gate = getCareWindowGate(before, after);
      const last = additions.at(-1);
      if (gate && last)
        additions[additions.length - 1] = { ...last, careWindowGateId: gate.eventId };
    }
  }
  const owned = new Set(additions.map((e) => e.render.objectId));
  const inspecting = cues.some((c) => c.kind === 'KOTORI_INSPECT');
  return [
    ...events.filter(
      (e) =>
        !(
          e.kind === 'CARD_MOVE' &&
          (owned.has(e.render.objectId) ||
            (inspecting && e.toZoneType === ZoneType.INSPECTION_ZONE))
        ) &&
        !(
          additions.length &&
          e.kind === 'ZONE_PULSE' &&
          (e.id.includes('stack:') || e.id.includes('inspection-cleanup:'))
        )
    ),
    ...additions,
  ];
}
