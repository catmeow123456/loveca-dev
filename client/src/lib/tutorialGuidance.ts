import type { BattleUiAnchorId } from './battleUiAnchors';

export type TutorialStepKind = 'INFO' | 'ACTION' | 'OBSERVE';
export type TutorialCalloutPlacement = 'AUTO' | 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';
export type TutorialMascotExpression = 'WELCOME' | 'READ_CARD' | 'CELEBRATE';

export type TutorialGuidanceTarget =
  | {
      readonly kind: 'ANCHOR';
      readonly anchor: BattleUiAnchorId;
      readonly padding?: number;
      readonly placement?: TutorialCalloutPlacement;
    }
  | {
      /** Object ids must come from the current projected player view. */
      readonly kind: 'OBJECT';
      readonly objectId: string;
      readonly padding?: number;
      readonly placement?: TutorialCalloutPlacement;
    };

export interface TutorialGuidancePresentation {
  readonly stepId: string;
  readonly kind: TutorialStepKind;
  readonly chapter: string;
  readonly title: string;
  readonly body: string;
  readonly mascot?: TutorialMascotExpression;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly target?: TutorialGuidanceTarget | null;
  /** Additional visible targets share the spotlight but do not position the callout. */
  readonly secondaryTargets?: readonly TutorialGuidanceTarget[];
  /** Used for an observation status or a concise instruction, never for private card data. */
  readonly statusText?: string;
  readonly continueLabel?: string;
}

export interface TutorialRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TutorialViewport {
  readonly width: number;
  readonly height: number;
}

export interface TutorialCalloutLayout {
  readonly left: number;
  readonly top: number;
  readonly placement: Exclude<TutorialCalloutPlacement, 'AUTO'>;
}

export function intersectTutorialRects(
  rect: TutorialRect,
  clip: TutorialRect
): TutorialRect | null {
  const left = Math.max(rect.left, clip.left);
  const top = Math.max(rect.top, clip.top);
  const right = Math.min(rect.left + rect.width, clip.left + clip.width);
  const bottom = Math.min(rect.top + rect.height, clip.top + clip.height);
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export function translateTutorialRect(
  rect: TutorialRect,
  offsetLeft: number,
  offsetTop: number
): TutorialRect {
  return {
    left: rect.left - offsetLeft,
    top: rect.top - offsetTop,
    width: rect.width,
    height: rect.height,
  };
}

const VIEWPORT_MARGIN = 12;
const TARGET_CALLOUT_GAP = 16;
const PRIMARY_TARGET_OVERLAP_WEIGHT = 1_000_000;
const SECONDARY_TARGET_OVERLAP_WEIGHT = 100;

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function expandTutorialTargetRect(
  rect: TutorialRect,
  padding: number,
  viewport: TutorialViewport
): TutorialRect {
  const safePadding = Math.max(0, padding);
  const left = clamp(rect.left - safePadding, 0, viewport.width);
  const top = clamp(rect.top - safePadding, 0, viewport.height);
  const right = clamp(rect.left + rect.width + safePadding, 0, viewport.width);
  const bottom = clamp(rect.top + rect.height + safePadding, 0, viewport.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function getPlacementOrder(
  preferred: TutorialCalloutPlacement
): readonly Exclude<TutorialCalloutPlacement, 'AUTO'>[] {
  if (preferred === 'AUTO') return ['BOTTOM', 'TOP', 'RIGHT', 'LEFT'];
  return [
    preferred,
    ...(['BOTTOM', 'TOP', 'RIGHT', 'LEFT'] as const).filter((item) => item !== preferred),
  ];
}

function getUnclampedCalloutPosition(
  placement: Exclude<TutorialCalloutPlacement, 'AUTO'>,
  target: TutorialRect,
  callout: TutorialRect
): Pick<TutorialCalloutLayout, 'left' | 'top'> {
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  switch (placement) {
    case 'TOP':
      return {
        left: targetCenterX - callout.width / 2,
        top: target.top - TARGET_CALLOUT_GAP - callout.height,
      };
    case 'RIGHT':
      return {
        left: target.left + target.width + TARGET_CALLOUT_GAP,
        top: targetCenterY - callout.height / 2,
      };
    case 'LEFT':
      return {
        left: target.left - TARGET_CALLOUT_GAP - callout.width,
        top: targetCenterY - callout.height / 2,
      };
    case 'BOTTOM':
      return {
        left: targetCenterX - callout.width / 2,
        top: target.top + target.height + TARGET_CALLOUT_GAP,
      };
  }
}

function getViewportOverflow(
  position: Pick<TutorialCalloutLayout, 'left' | 'top'>,
  callout: TutorialRect,
  viewport: TutorialViewport
): number {
  const overflowLeft = Math.max(0, VIEWPORT_MARGIN - position.left);
  const overflowTop = Math.max(0, VIEWPORT_MARGIN - position.top);
  const overflowRight = Math.max(
    0,
    position.left + callout.width + VIEWPORT_MARGIN - viewport.width
  );
  const overflowBottom = Math.max(
    0,
    position.top + callout.height + VIEWPORT_MARGIN - viewport.height
  );
  return overflowLeft + overflowTop + overflowRight + overflowBottom;
}

function getRectOverlapArea(left: TutorialRect, right: TutorialRect): number {
  const overlapWidth = Math.max(
    0,
    Math.min(left.left + left.width, right.left + right.width) - Math.max(left.left, right.left)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top)
  );
  return overlapWidth * overlapHeight;
}

export function placeTutorialCallout(
  target: TutorialRect | null,
  callout: Pick<TutorialRect, 'width' | 'height'>,
  viewport: TutorialViewport,
  preferred: TutorialCalloutPlacement = 'AUTO',
  protectedTargets: readonly TutorialRect[] = target ? [target] : []
): TutorialCalloutLayout {
  const safeCallout: TutorialRect = {
    left: 0,
    top: 0,
    width: Math.min(Math.max(1, callout.width), Math.max(1, viewport.width - VIEWPORT_MARGIN * 2)),
    height: Math.min(
      Math.max(1, callout.height),
      Math.max(1, viewport.height - VIEWPORT_MARGIN * 2)
    ),
  };

  if (!target) {
    return {
      left: clamp(
        (viewport.width - safeCallout.width) / 2,
        VIEWPORT_MARGIN,
        viewport.width - VIEWPORT_MARGIN - safeCallout.width
      ),
      top: clamp(
        viewport.height - VIEWPORT_MARGIN - safeCallout.height,
        VIEWPORT_MARGIN,
        viewport.height - VIEWPORT_MARGIN - safeCallout.height
      ),
      placement: 'BOTTOM',
    };
  }

  const candidates = getPlacementOrder(preferred).map((placement, order) => {
    const unclampedPosition = getUnclampedCalloutPosition(placement, target, safeCallout);
    const position = {
      left: clamp(
        unclampedPosition.left,
        VIEWPORT_MARGIN,
        viewport.width - VIEWPORT_MARGIN - safeCallout.width
      ),
      top: clamp(
        unclampedPosition.top,
        VIEWPORT_MARGIN,
        viewport.height - VIEWPORT_MARGIN - safeCallout.height
      ),
    };
    const positionedCallout: TutorialRect = { ...safeCallout, ...position };
    const primaryTargetOverlap = protectedTargets[0]
      ? getRectOverlapArea(positionedCallout, protectedTargets[0])
      : 0;
    const secondaryTargetOverlap = protectedTargets
      .slice(1)
      .reduce(
        (total, protectedTarget) => total + getRectOverlapArea(positionedCallout, protectedTarget),
        0
      );
    return {
      placement,
      position,
      // The primary target is the current interaction. It must remain usable even when
      // a large secondary teaching region makes every candidate overlap something.
      score:
        primaryTargetOverlap * PRIMARY_TARGET_OVERLAP_WEIGHT +
        secondaryTargetOverlap * SECONDARY_TARGET_OVERLAP_WEIGHT +
        getViewportOverflow(unclampedPosition, safeCallout, viewport) * 10 +
        order,
    };
  });
  const selected = candidates.reduce((best, candidate) =>
    candidate.score < best.score ? candidate : best
  );

  return {
    left: selected.position.left,
    top: selected.position.top,
    placement: selected.placement,
  };
}
