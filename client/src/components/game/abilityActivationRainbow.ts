import { createActivationFlowPainter } from './abilityActivationFlow';

/** Preserve the previous 1.5x perimeter motion, replacing only the light material. */
export function createActivationRainbowPainter(canvas: HTMLCanvasElement) {
  return createActivationFlowPainter(canvas, 1.5, 'rainbow');
}
