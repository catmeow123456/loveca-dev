import type { SlotPosition } from '../types/enums.js';

export type CardDefinedSpecialMemberPlayMode =
  'LL_BP7_001_SPECIAL_PLAY' | 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO';

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
