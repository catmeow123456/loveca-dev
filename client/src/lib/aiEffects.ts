import type { PlayerViewState } from '@game/online';
import { N_BP8_005_ACTIVATED_TAP_ENERGY_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID as AI_ID } from '@game/application/card-effects/ability-ids';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';
import { ZoneType } from '@game/shared/types/enums';
import type { BattleAnimationAnchorMaps, BattleAnimationEvent } from './battleAnimationEvents';

export const AI_SHARE_MS = 740;
export const AI_INVITATION_MS = 940;
export interface AiHeartLink {
  key: string;
  sourceId: string;
  targetId: string;
}
export function aiHeartLinks(view: PlayerViewState | null): AiHeartLink[] {
  return Object.values(view?.objects ?? {}).flatMap((o) =>
    (o.aiHeartLinks ?? []).map((link) => ({
      key: `${link.sourceObjectId}:${o.publicObjectId}:${link.incarnation}`,
      sourceId: link.sourceObjectId,
      targetId: o.publicObjectId,
    }))
  );
}
export function isAiRecoveryEffect(view: PlayerViewState | null) {
  const effect = view?.activeEffect;
  const code =
    effect &&
    (view?.objects[effect.sourceObjectId]?.frontInfo?.cardCode ?? effect.sourceCardDisplayCode);
  return (
    !!effect && effect.abilityId === AI_ID && !!code && cardCodeMatchesBase(code, 'PL!N-bp8-005')
  );
}

/** Decorates only a completed, previously public selection. No target qualification in React. */
export function withAiRecoveryPresentation(
  previous: PlayerViewState,
  next: PlayerViewState,
  events: BattleAnimationEvent[],
  anchors: BattleAnimationAnchorMaps,
  enabled = true
): BattleAnimationEvent[] {
  if (
    !enabled ||
    !isAiRecoveryEffect(previous) ||
    previous.match.matchId !== next.match.matchId ||
    previous.match.viewerSeat !== next.match.viewerSeat ||
    next.match.seq <= previous.match.seq
  )
    return events;
  const effect = previous.activeEffect!;
  const selected = effect.revealedObjectIds;
  if (
    effect.stepId !== 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION' ||
    selected?.length !== 1 ||
    !effect.controllerSeat
  )
    return events;
  const objectId = selected[0];
  const publicCard = previous.objects[objectId];
  const code = publicCard?.surface === 'FRONT' ? publicCard.frontInfo?.cardCode : undefined;
  const seat = effect.controllerSeat;
  const waiting = `${seat}_WAITING_ROOM` as const,
    hand = `${seat}_HAND` as const;
  if (
    !code ||
    !previous.table.zones[waiting]?.objectIds?.includes(objectId) ||
    next.table.zones[waiting]?.objectIds?.includes(objectId) ||
    next.table.zones[hand]?.count !== (previous.table.zones[hand]?.count ?? 0) + 1
  )
    return events;
  const aiInvitation = { sourceObjectId: effect.sourceObjectId, publicCardCode: code };
  let found = false;
  const decorated = events.map((event) => {
    if (
      event.kind !== 'CARD_MOVE' ||
      event.render.objectId !== objectId ||
      event.fromZoneType !== ZoneType.WAITING_ROOM ||
      event.toZoneType !== ZoneType.HAND
    )
      return event;
    found = true;
    return { ...event, aiInvitation };
  });
  if (found) return decorated;
  // The opponent's destination is anonymous. Keep only the already-public face until it
  // reaches the anonymous hand zone; never associate it with a hidden hand object.
  if (next.objects[objectId] || next.match.viewerSeat === seat) return events;
  const fromRect = anchors.zones.get(`seat-${seat}::waiting-room`);
  const toRect = anchors.zones.get(`seat-${seat}::hand`);
  if (!fromRect || !toRect) return events;
  return [
    ...decorated,
    {
      id: `ai-recover:${next.match.seq}:${objectId}`,
      kind: 'CARD_MOVE',
      render: { objectId, cardId: '', fromSurface: 'FRONT', toSurface: 'BACK', surface: 'BACK' },
      fromZoneType: ZoneType.WAITING_ROOM,
      toZoneType: ZoneType.HAND,
      toSeat: seat,
      toZoneKey: hand,
      fromRect,
      toRect,
      aiInvitation,
    },
  ];
}
