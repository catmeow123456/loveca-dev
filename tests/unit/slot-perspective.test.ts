import { describe, expect, it } from 'vitest';
import { SlotPosition } from '../../src/shared/types/enums';
import { toPlayerLocalSlotForControllerPerspective } from '../../src/shared/utils/slot-perspective';

describe('slot perspective helper', () => {
  it('keeps own slots local and mirrors opponent left/right slots', () => {
    expect(toPlayerLocalSlotForControllerPerspective(SlotPosition.LEFT, 'p1', 'p1')).toBe(
      SlotPosition.LEFT
    );
    expect(toPlayerLocalSlotForControllerPerspective(SlotPosition.RIGHT, 'p1', 'p2')).toBe(
      SlotPosition.LEFT
    );
    expect(toPlayerLocalSlotForControllerPerspective(SlotPosition.LEFT, 'p1', 'p2')).toBe(
      SlotPosition.RIGHT
    );
    expect(toPlayerLocalSlotForControllerPerspective(SlotPosition.CENTER, 'p1', 'p2')).toBe(
      SlotPosition.CENTER
    );
  });
});
