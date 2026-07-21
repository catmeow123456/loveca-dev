import { CardType, SlotPosition, ZoneType } from '@game/shared/types/enums';

export interface ActiveEffectCardLocationInput {
  cardType: CardType | null | undefined;
  zone: ZoneType | null | undefined;
  slot: SlotPosition | null | undefined;
  isStageSlotOccupant: boolean;
}

const STAGE_SLOT_LOCATION_LABELS: Readonly<Record<SlotPosition, string>> = {
  [SlotPosition.LEFT]: '左',
  [SlotPosition.CENTER]: '中',
  [SlotPosition.RIGHT]: '右',
};

export function getActiveEffectCardLocationLabel({
  cardType,
  zone,
  slot,
  isStageSlotOccupant,
}: ActiveEffectCardLocationInput): string | null {
  if (cardType !== CardType.MEMBER) return null;

  if (zone === ZoneType.HAND) return '手牌';
  if (zone === ZoneType.WAITING_ROOM) return '休息';
  if (zone !== ZoneType.MEMBER_SLOT || !slot || !isStageSlotOccupant) return null;

  return STAGE_SLOT_LOCATION_LABELS[slot] ?? null;
}

export function formatActiveEffectCardLabelWithLocation(
  cardLabel: string,
  location: ActiveEffectCardLocationInput
): string {
  const locationLabel = getActiveEffectCardLocationLabel(location);
  return locationLabel ? `${locationLabel} ${cardLabel}` : cardLabel;
}
