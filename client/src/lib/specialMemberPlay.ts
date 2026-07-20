import type { ViewCommandHint } from '@game/online';
import type { SlotPosition } from '@game/shared/types/enums';

export const LL_BP7_001_SPECIAL_PLAY_UI_CARD_CODE = 'LL-bp7-001-R+';

export function getSpecialMemberPlayTargetSlots(
  hint: ViewCommandHint | null,
  sourceObjectId: string | null
): readonly SlotPosition[] {
  if (!hint?.enabled || !sourceObjectId || !hint.scope?.objectIds?.includes(sourceObjectId)) {
    return [];
  }
  const targetSlotsByObjectId = hint.params?.targetSlotsByObjectId as
    Readonly<Record<string, readonly SlotPosition[]>> | undefined;
  return targetSlotsByObjectId?.[sourceObjectId] ?? [];
}
