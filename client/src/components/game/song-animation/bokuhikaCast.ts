import { normalizeMemberName } from '@game/shared/utils/card-identity';
import { PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID } from '@game/application/card-effects/ability-ids';
import type { ActiveEffectViewState } from '@game/online/types';

/** Fixed BP5 P portraits wear the song costume; identities never look up a deck/hand. */
export const BOKUHIKA_CAST = [
  {
    id: 'honoka',
    name: '高坂穂乃果',
    label: '穗乃果',
    color: '#ffac55',
    cardCode: 'PL!-bp5-001-P',
    crop: [225, 115, 540],
  },
  {
    id: 'eli',
    name: '絢瀬絵里',
    label: '绘里',
    color: '#8de3ff',
    cardCode: 'PL!-bp5-002-P',
    crop: [220, 80, 520],
  },
  {
    id: 'kotori',
    name: '南ことり',
    label: '小鸟',
    color: '#e9ebd8',
    cardCode: 'PL!-bp5-003-P',
    crop: [240, 70, 570],
  },
  {
    id: 'umi',
    name: '園田海未',
    label: '海未',
    color: '#82a5ff',
    cardCode: 'PL!-bp5-004-P',
    crop: [225, 110, 530],
  },
  {
    id: 'rin',
    name: '星空凛',
    label: '凛',
    color: '#ffe477',
    cardCode: 'PL!-bp5-005-P',
    crop: [400, 50, 470],
  },
  {
    id: 'maki',
    name: '西木野真姫',
    label: '真姬',
    color: '#ec6987',
    cardCode: 'PL!-bp5-006-P',
    crop: [155, 60, 560],
  },
  {
    id: 'nozomi',
    name: '東條希',
    label: '希',
    color: '#bb97ed',
    cardCode: 'PL!-bp5-007-P',
    crop: [240, 60, 540],
  },
  {
    id: 'hanayo',
    name: '小泉花陽',
    label: '花阳',
    color: '#9bdd9a',
    cardCode: 'PL!-bp5-008-P',
    crop: [145, 115, 550],
  },
  {
    id: 'nico',
    name: '矢澤にこ',
    label: '妮可',
    color: '#ff9dcb',
    cardCode: 'PL!-bp5-009-P',
    crop: [315, 80, 600],
  },
] as const;

export type BokuhikaMemberId = (typeof BOKUHIKA_CAST)[number]['id'];
export interface BokuhikaContribution {
  readonly members: readonly BokuhikaMemberId[];
  readonly scoreBonus: number;
}

/** Consume evaluated public names; never derive score from visible art/card counts. */
export function bokuhikaContributionFromNames(
  normalizedNames: readonly string[],
  scoreBonus: number
): BokuhikaContribution | null {
  if (!Number.isInteger(scoreBonus)) return null;
  const members: BokuhikaMemberId[] = [];
  for (const name of normalizedNames) {
    if (typeof name !== 'string') return null;
    const member = BOKUHIKA_CAST.find(
      (m) => normalizeMemberName(m.name) === normalizeMemberName(name)
    );
    if (!member || members.includes(member.id)) return null;
    members.push(member.id);
  }
  // Unsupported or inconsistent facts use ordinary effect feedback, never invent lit positions.
  if (members.length !== scoreBonus) return null;
  return { members, scoreBonus };
}

/** A queued ability/order picker is not yet this selected confirmation. */
export function bokuhikaSuccessCueKey(
  effect:
    Pick<ActiveEffectViewState, 'id' | 'abilityId' | 'stepId' | 'sourceObjectId'> | null | undefined
): string | null {
  if (
    effect?.abilityId !== PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID ||
    effect.stepId !== 'CONFIRM_ONLY_EFFECT'
  )
    return null;
  return `${effect.id}:${effect.sourceObjectId}:${effect.stepId}`;
}

export const BOKUHIKA_SUCCESS_DURATION = 3200;
export const castAngle = (index: number) => (index * Math.PI * 2) / 9 - Math.PI / 2;
