import type { SlotPosition } from '../types/enums.js';

export const CARD_DEFINED_SPECIAL_MEMBER_PLAY_MODES = [
  'LL_BP7_001_SPECIAL_PLAY',
  'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
  'PL_PB2_012_WAIT_PRINTEMPS_COST_MINUS_TWO',
] as const;

export type CardDefinedSpecialMemberPlayMode =
  (typeof CARD_DEFINED_SPECIAL_MEMBER_PLAY_MODES)[number];

export type MemberPlayOptionId = 'DOUBLE_RELAY' | CardDefinedSpecialMemberPlayMode;

export interface MemberPlayOptionSelectionDescriptor {
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly mustIncludeTarget: boolean;
}

export interface MemberPlayOption {
  readonly id: MemberPlayOptionId;
  readonly label: string;
  readonly kind: 'DOUBLE_RELAY' | 'CARD_DEFINED';
  readonly title: string;
  readonly description: string;
  readonly targetSlots: readonly SlotPosition[];
  readonly mode?: CardDefinedSpecialMemberPlayMode;
  readonly selection?: MemberPlayOptionSelectionDescriptor;
}
