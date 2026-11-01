import type { PlayerViewState, ViewZoneState } from '@game/online';
import {
  PL_BP8_003_ACTIVATED_WAIT_DISCARD_LOOK_TOP_TWO_ABILITY_ID as KOTORI,
  N_BP8_001_ON_ENTER_STACK_ENERGY_SELF_AND_OTHER_NIJIGASAKI_ABILITY_ID as AYUMU_ENTER,
  N_BP8_001_LIVE_SUCCESS_RETURN_ONE_ENERGY_BELOW_DRAW_DISCARD_ABILITY_ID as AYUMU_RETURN,
} from '@game/application/card-effects/ability-ids';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';
import { ZoneType } from '@game/shared/types/enums';

export type CareEffectKind = 'KOTORI_INSPECT' | 'KOTORI_KEEP' | 'AYUMU_GIVE' | 'AYUMU_RETURN';
export interface CareEffectCue {
  key: string;
  kind: CareEffectKind;
  sourceId: string;
  ownerSeat: 'FIRST' | 'SECOND';
  /** Only public recipients, never inspected/kept hand identities. */
  targets: readonly { memberId: string; energyId: string }[];
}

const zone = (view: PlayerViewState, seat: string, type: ZoneType) =>
  Object.values(view.table.zones).find((z) => z.ownerSeat === seat && z.zone === type);
const stage = (view: PlayerViewState, id: string) =>
  Object.values(view.table.zones).find(
    (z) => z.zone === ZoneType.MEMBER_SLOT && Object.values(z.slotMap ?? {}).includes(id)
  );
const energies = (z: ViewZoneState | undefined) => Object.values(z?.overlays ?? {}).flat();

/** Observe completed, public movements inside the existing ability's selection boundary.
 * These cues contain no card faces or private inspection identities and never drive rules.
 */
export function getCareEffectCues(
  before: PlayerViewState | null,
  after: PlayerViewState | null
): CareEffectCue[] {
  if (
    !before ||
    !after ||
    after.match.endInfo ||
    before.match.matchId !== after.match.matchId ||
    before.match.viewerSeat !== after.match.viewerSeat ||
    after.match.seq <= before.match.seq
  )
    return [];
  const effect = before.activeEffect;
  if (!effect || ![KOTORI, AYUMU_ENTER, AYUMU_RETURN].includes(effect.abilityId)) return [];
  const sourceId = effect.sourceObjectId;
  const source = after.objects[sourceId];
  const code = source?.frontInfo?.cardCode;
  const previousStage = stage(before, sourceId);
  const currentStage = stage(after, sourceId);
  if (
    !code ||
    !previousStage ||
    !currentStage ||
    Object.keys(previousStage.slotMap ?? {})[0] !== Object.keys(currentStage.slotMap ?? {})[0] ||
    !cardCodeMatchesBase(code, effect.abilityId === KOTORI ? 'PL!-bp8-003' : 'PL!N-bp8-001')
  )
    return [];
  const ownerSeat = source.ownerSeat;
  const cue = (kind: CareEffectKind, targets: CareEffectCue['targets'] = []): CareEffectCue[] => [
    {
      key: `${kind}:${after.match.seq}:${effect.id}`,
      kind,
      sourceId,
      ownerSeat,
      targets,
    },
  ];
  if (effect.abilityId === KOTORI) {
    if (
      effect.stepId === 'DISCARD_LOOK_SELECT_DISCARD' &&
      after.activeEffect?.id === effect.id &&
      after.activeEffect.stepId === 'DISCARD_LOOK_SELECT_TAKE'
    )
      return cue('KOTORI_INSPECT');
    if (
      effect.stepId === 'DISCARD_LOOK_SELECT_TAKE' &&
      (after.activeEffect?.id !== effect.id || after.activeEffect.stepId !== effect.stepId) &&
      (zone(after, ownerSeat, ZoneType.HAND)?.count ?? 0) ===
        (zone(before, ownerSeat, ZoneType.HAND)?.count ?? 0) + 1
    )
      return cue('KOTORI_KEEP');
    return [];
  }
  if (
    effect.abilityId === AYUMU_ENTER &&
    [
      'N_BP8_001_CHOOSE_ENERGY_ALLOCATION',
      'N_BP8_001_SELECT_OTHER_NIJIGASAKI',
      'N_BP8_001_SELECT_PLACEMENT_ENERGY',
    ].includes(effect.stepId)
  ) {
    const from = zone(before, ownerSeat, ZoneType.ENERGY_ZONE)?.objectIds ?? [];
    const to = zone(after, ownerSeat, ZoneType.ENERGY_ZONE)?.objectIds ?? [];
    const targets = Object.values(after.table.zones).flatMap((z) => {
      const id = Object.values(z.slotMap ?? {})[0];
      if (z.ownerSeat !== ownerSeat || !id || !stage(before, id)) return [];
      return energies(z)
        .filter(
          (e) => from.includes(e) && !to.includes(e) && !energies(stage(before, id)).includes(e)
        )
        .map((energyId) => ({ memberId: id, energyId }));
    });
    return targets.length ? cue('AYUMU_GIVE', targets) : [];
  }
  if (effect.abilityId === AYUMU_RETURN && effect.stepId === 'N_BP8_001_SELECT_ONE_ENERGY_BELOW') {
    const from = zone(before, ownerSeat, ZoneType.ENERGY_ZONE)?.objectIds ?? [];
    const added = (zone(after, ownerSeat, ZoneType.ENERGY_ZONE)?.objectIds ?? []).filter(
      (id) => !from.includes(id) && effect.selectableObjectIds?.includes(id)
    );
    const targets = Object.values(before.table.zones).flatMap((z) => {
      const id = Object.values(z.slotMap ?? {})[0];
      if (z.ownerSeat !== ownerSeat || !id || !stage(after, id)) return [];
      return added
        .filter((e) => energies(z).includes(e) && !energies(stage(after, id)).includes(e))
        .map((energyId) => ({ memberId: id, energyId }));
    });
    return targets.length === 1 ? cue('AYUMU_RETURN', targets) : [];
  }
  return [];
}

export function isCareEffectCurrent(view: PlayerViewState | null, cue: CareEffectCue): boolean {
  if (!view || view.match.endInfo || !stage(view, cue.sourceId)) return false;
  return cue.targets.every(
    ({ memberId, energyId }) =>
      !!stage(view, memberId) &&
      (cue.kind === 'AYUMU_GIVE'
        ? energies(stage(view, memberId)).includes(energyId)
        : zone(view, cue.ownerSeat, ZoneType.ENERGY_ZONE)?.objectIds?.includes(energyId))
  );
}
