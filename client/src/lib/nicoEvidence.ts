import type { PlayerViewState } from '@game/online';
import { PL_BP8_009_ACTIVATED_PAY_TWO_ENERGY_STACK_HAND_MEMBER_BELOW_ABILITY_ID as NICO_ID } from '@game/application/card-effects/ability-ids';
import { ZoneType } from '@game/shared/types/enums';

export const NICO_EVIDENCE_MS = 1392;
export interface NicoEvidencePresentation {
  key: string;
  hostId: string;
  incarnation: string;
  cardId: string;
  cardCode: string;
  cardName: string;
  ownerSeat: 'FIRST' | 'SECOND';
  newCostKind: boolean;
}

/** A completed public stack, never an unconfirmed hand choice or client-side cost calculation. */
export function getNicoEvidencePresentation(
  before: PlayerViewState | null,
  after: PlayerViewState | null
): NicoEvidencePresentation | null {
  if (
    !before ||
    !after ||
    after.match.endInfo ||
    before.match.matchId !== after.match.matchId ||
    before.match.viewerSeat !== after.match.viewerSeat ||
    after.match.seq <= before.match.seq
  )
    return null;
  const effect = before.activeEffect;
  if (effect?.abilityId !== NICO_ID || effect.stepId !== 'PL_BP8_009_SELECT_HAND_MEMBER_BELOW')
    return null;
  const hostId = effect.sourceObjectId;
  const old = before.objects[hostId]?.nicoEvidence;
  const host = after.objects[hostId];
  const status = host?.nicoEvidence;
  if (!old || !status || old.incarnation !== status.incarnation) return null;
  for (const [key, zone] of Object.entries(after.table.zones)) {
    if (zone.zone !== ZoneType.MEMBER_SLOT) continue;
    const slot = Object.entries(zone.slotMap ?? {}).find(([, id]) => id === hostId)?.[0];
    if (!slot) continue;
    const previousZone = before.table.zones[key as keyof typeof before.table.zones];
    if (previousZone?.slotMap?.[slot] !== hostId) return null;
    const added = (zone.memberBelow?.[slot] ?? []).filter(
      (id) => !previousZone.memberBelow?.[slot]?.includes(id)
    );
    if (added.length !== 1) return null;
    const card = after.objects[added[0]];
    if (card?.surface !== 'FRONT' || !card.frontInfo) return null;
    return {
      key: `nico:${after.match.seq}:${hostId}:${added[0]}`,
      hostId,
      incarnation: status.incarnation,
      cardId: added[0],
      cardCode: card.frontInfo.cardCode,
      cardName: card.frontInfo.nameCn || card.frontInfo.nameJp || card.frontInfo.cardCode,
      ownerSeat: host.ownerSeat,
      newCostKind: status.costKinds > old.costKinds,
    };
  }
  return null;
}

export function isNicoEvidenceCurrent(view: PlayerViewState | null, cue: NicoEvidencePresentation) {
  if (
    !view ||
    view.match.endInfo ||
    view.objects[cue.hostId]?.nicoEvidence?.incarnation !== cue.incarnation
  )
    return false;
  return Object.values(view.table.zones).some((zone) =>
    Object.entries(zone.slotMap ?? {}).some(
      ([slot, id]) => id === cue.hostId && zone.memberBelow?.[slot]?.includes(cue.cardId)
    )
  );
}
