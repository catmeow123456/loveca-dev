import type {
  ActivityCoverCrop,
  ActivityCoverFocus,
  ActivityCoverLayout,
} from '@game/online/activity-cover-types';

const LAYOUT_ASPECT: Record<ActivityCoverLayout, number> = {
  WIDE: 16 / 7,
  COMPACT: 4 / 3,
};

export function computeActivityCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  layout: ActivityCoverLayout,
  focus: ActivityCoverFocus,
  zoom = 1
): ActivityCoverCrop {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('封面尺寸无效');
  const targetAspect = LAYOUT_ASPECT[layout];
  const sourceAspect = sourceWidth / sourceHeight;
  const normalizedZoom = Math.min(2, Math.max(1, zoom));
  let width = 1;
  let height = 1;
  if (sourceAspect > targetAspect) width = targetAspect / sourceAspect;
  else height = sourceAspect / targetAspect;
  width /= normalizedZoom;
  height /= normalizedZoom;
  const normalizedFocus = { x: clamp01(focus.x), y: clamp01(focus.y) };
  return {
    x: clamp(normalizedFocus.x - width / 2, 0, 1 - width),
    y: clamp(normalizedFocus.y - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function inferActivityCoverZoom(
  sourceWidth: number,
  sourceHeight: number,
  layout: ActivityCoverLayout,
  crop: ActivityCoverCrop
): number {
  const base = computeActivityCoverCrop(sourceWidth, sourceHeight, layout, { x: 0.5, y: 0.5 });
  return Math.min(2, Math.max(1, base.width / crop.width, base.height / crop.height));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
