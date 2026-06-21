import { SlotPosition } from '../types/enums.js';

export function toPlayerLocalSlotForControllerPerspective(
  slot: SlotPosition,
  controllerId: string,
  targetPlayerId: string
): SlotPosition {
  if (controllerId === targetPlayerId || slot === SlotPosition.CENTER) {
    return slot;
  }

  return slot === SlotPosition.LEFT ? SlotPosition.RIGHT : SlotPosition.LEFT;
}
