import { PointerSensor, type PointerSensorProps } from '@dnd-kit/core';

export class BattlePointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    const event = props.event as PointerEvent;
    const browsingHand =
      event.pointerType === 'touch' &&
      props.activeNode.node.current?.closest('[data-hand-viewport]');
    super(
      browsingHand
        ? {
            ...props,
            options: {
              ...props.options,
              // Native horizontal pan wins once selected; lift vertically to drag out.
              activationConstraint: { distance: { y: 7 }, tolerance: { x: 8 } },
            },
          }
        : props
    );
  }
}
