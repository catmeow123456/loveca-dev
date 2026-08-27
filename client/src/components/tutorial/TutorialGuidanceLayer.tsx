import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Eye, MousePointer2 } from 'lucide-react';
import { CardEffectText } from '@/components/card/CardEffectText';
import {
  BATTLE_UI_ANCHORS,
  BATTLE_UI_ANCHOR_ATTRIBUTE,
  BATTLE_UI_OBJECT_ATTRIBUTE,
} from '@/lib/battleUiAnchors';
import {
  expandTutorialTargetRect,
  intersectTutorialRects,
  placeTutorialCallout,
  translateTutorialRect,
  type TutorialGuidancePresentation,
  type TutorialGuidanceTarget,
  type TutorialRect,
  type TutorialViewport,
} from '@/lib/tutorialGuidance';
import { TUTORIAL_STICKER_ASSETS } from '@/lib/tutorialMascotAssets';
import {
  readBattleViewportSignature,
  subscribeToBattleViewportChanges,
} from '@/lib/battleViewport';
import { cn } from '@/lib/utils';

export interface TutorialGuidanceLayerProps {
  readonly presentation: TutorialGuidancePresentation | null;
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
  readonly onTargetVisibilityChange?: (visible: boolean) => void;
}

interface TutorialVisualViewport extends TutorialViewport {
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly scale: number;
}

function readTutorialVisualViewport(): TutorialVisualViewport {
  const signature = readBattleViewportSignature();
  return {
    width: signature?.width ?? 1280,
    height: signature?.height ?? 720,
    offsetLeft: signature?.offsetLeft ?? 0,
    offsetTop: signature?.offsetTop ?? 0,
    scale: signature?.scale ?? 1,
  };
}

function sameViewport(left: TutorialVisualViewport, right: TutorialVisualViewport): boolean {
  return (
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5 &&
    Math.abs(left.offsetLeft - right.offsetLeft) < 0.5 &&
    Math.abs(left.offsetTop - right.offsetTop) < 0.5 &&
    Math.abs(left.scale - right.scale) < 0.01
  );
}

function isElementRendered(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    style.contentVisibility !== 'hidden'
  );
}

function findRenderedElementByAttribute(attribute: string, value: string): HTMLElement | null {
  const elements = document.querySelectorAll<HTMLElement>(`[${attribute}]`);
  for (const element of elements) {
    if (element.getAttribute(attribute) === value && isElementRendered(element)) {
      return element;
    }
  }
  return null;
}

function resolveTutorialTarget(target: TutorialGuidanceTarget): HTMLElement | null {
  if (target.kind === 'ANCHOR') {
    return findRenderedElementByAttribute(BATTLE_UI_ANCHOR_ATTRIBUTE, target.anchor);
  }

  const normalizedObjectId = target.objectId.replace(/^obj_/, '');
  const explicitObject = findRenderedElementByAttribute(
    BATTLE_UI_OBJECT_ATTRIBUTE,
    normalizedObjectId
  );
  if (explicitObject) return explicitObject;

  return (
    findRenderedElementByAttribute('data-object-id', `obj_${normalizedObjectId}`) ??
    findRenderedElementByAttribute('data-object-id', normalizedObjectId)
  );
}

function clipsOverflow(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip';
}

function clipRectByAncestor(rect: TutorialRect, ancestor: HTMLElement): TutorialRect | null {
  const style = window.getComputedStyle(ancestor);
  const clipsX = clipsOverflow(style.overflowX);
  const clipsY = clipsOverflow(style.overflowY);
  if (!clipsX && !clipsY) return rect;

  const ancestorRect = toTutorialRect(ancestor.getBoundingClientRect());
  const clip: TutorialRect = {
    left: clipsX ? ancestorRect.left : rect.left,
    top: clipsY ? ancestorRect.top : rect.top,
    width: clipsX ? ancestorRect.width : rect.width,
    height: clipsY ? ancestorRect.height : rect.height,
  };
  return intersectTutorialRects(rect, clip);
}

function getElementVisibleRect(
  element: HTMLElement,
  viewport: TutorialVisualViewport
): TutorialRect | null {
  if (!isElementRendered(element)) return null;
  const viewportRect: TutorialRect = {
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    width: viewport.width,
    height: viewport.height,
  };
  let visibleRect = intersectTutorialRects(
    toTutorialRect(element.getBoundingClientRect()),
    viewportRect
  );
  if (!visibleRect) return null;

  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    visibleRect = clipRectByAncestor(visibleRect, ancestor);
    if (!visibleRect) return null;
    ancestor = ancestor.parentElement;
  }
  return translateTutorialRect(visibleRect, viewport.offsetLeft, viewport.offsetTop);
}

function hasUsableTutorialTargetArea(
  element: HTMLElement,
  visibleRect: TutorialRect | null
): boolean {
  if (!visibleRect) return false;
  const rect = element.getBoundingClientRect();
  return (
    visibleRect.width >= Math.min(24, rect.width) && visibleRect.height >= Math.min(24, rect.height)
  );
}

function isScrollableAncestor(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const scrollsY =
    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
    element.scrollHeight > element.clientHeight + 1;
  const scrollsX =
    (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
    element.scrollWidth > element.clientWidth + 1;
  return scrollsX || scrollsY;
}

function scrollTutorialActionTargetIntoView(element: HTMLElement, reduceMotion: boolean): boolean {
  if (typeof element.scrollIntoView !== 'function') return false;
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    if (isScrollableAncestor(ancestor)) {
      element.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

function resolveTutorialHandStackItem(
  target: TutorialGuidanceTarget,
  element: HTMLElement
): HTMLElement | null {
  if (target.kind !== 'OBJECT') return null;
  const hand = element.closest<HTMLElement>(
    `[${BATTLE_UI_ANCHOR_ATTRIBUTE}="${BATTLE_UI_ANCHORS.SELF_HAND}"]`
  );
  if (!hand) return null;

  let candidate: HTMLElement | null = element;
  while (candidate && candidate.parentElement !== hand) {
    if (window.getComputedStyle(candidate).position === 'absolute') return candidate;
    candidate = candidate.parentElement;
  }
  return candidate && window.getComputedStyle(candidate).position === 'absolute' ? candidate : null;
}

function toTutorialRect(rect: DOMRect): TutorialRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function sameRect(left: TutorialRect | null, right: TutorialRect | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function sameRects(
  left: readonly (TutorialRect | null)[],
  right: readonly (TutorialRect | null)[]
): boolean {
  return (
    left.length === right.length &&
    left.every((rect, index) => sameRect(rect, right[index] ?? null))
  );
}

export const TutorialGuidanceLayer = memo(function TutorialGuidanceLayer({
  presentation,
  onBack,
  onContinue,
  onTargetVisibilityChange,
}: TutorialGuidanceLayerProps) {
  const reduceMotion = useReducedMotion();
  const spotlightMaskId = `tutorial-spotlight-${useId().replaceAll(':', '')}`;
  const calloutRef = useRef<HTMLElement>(null);
  const targetVisibleRef = useRef<boolean | null>(null);
  const [targetRects, setTargetRects] = useState<readonly (TutorialRect | null)[]>([]);
  const [calloutSize, setCalloutSize] = useState({ width: 360, height: 220 });
  const [viewport, setViewport] = useState<TutorialVisualViewport>(readTutorialVisualViewport);

  const reportTargetVisibility = useCallback(
    (visible: boolean) => {
      if (targetVisibleRef.current === visible) return;
      targetVisibleRef.current = visible;
      onTargetVisibilityChange?.(visible);
    },
    [onTargetVisibilityChange]
  );
  const targets = useMemo(
    () =>
      presentation?.target ? [presentation.target, ...(presentation.secondaryTargets ?? [])] : [],
    [presentation?.secondaryTargets, presentation?.target]
  );

  useLayoutEffect(() => {
    if (targets.length === 0) {
      setTargetRects([]);
      reportTargetVisibility(true);
      return;
    }

    let animationFrame = 0;
    let observedElements: readonly HTMLElement[] = [];
    let autoScrolledElement: HTMLElement | null = null;
    const elevatedHandItems = new Map<HTMLElement, string>();
    const resizeObserver = new ResizeObserver(() => scheduleUpdate());

    const restoreElevatedHandItem = (element: HTMLElement) => {
      const originalZIndex = elevatedHandItems.get(element);
      if (originalZIndex === undefined) return;
      element.style.zIndex = originalZIndex;
      element.removeAttribute('data-tutorial-elevated-hand-card');
      elevatedHandItems.delete(element);
    };

    const update = () => {
      animationFrame = 0;
      const nextViewport = readTutorialVisualViewport();
      const nextElements = targets.map(resolveTutorialTarget);
      const visibleElements = nextElements.filter(
        (element): element is HTMLElement => element !== null
      );
      const observedElementsChanged =
        visibleElements.length !== observedElements.length ||
        visibleElements.some((element, index) => element !== observedElements[index]);
      if (observedElementsChanged) {
        resizeObserver.disconnect();
        observedElements = visibleElements;
        observedElements.forEach((element) => resizeObserver.observe(element));
      }

      const nextElevatedHandItems = new Set(
        nextElements.flatMap((element, index) => {
          if (!element) return [];
          const handItem = resolveTutorialHandStackItem(targets[index]!, element);
          return handItem ? [handItem] : [];
        })
      );
      for (const element of elevatedHandItems.keys()) {
        if (!nextElevatedHandItems.has(element)) restoreElevatedHandItem(element);
      }
      for (const element of nextElevatedHandItems) {
        if (!elevatedHandItems.has(element)) {
          elevatedHandItems.set(element, element.style.zIndex);
        }
        element.setAttribute('data-tutorial-elevated-hand-card', 'true');
        element.style.zIndex = '50';
      }

      const measuredRects = nextElements.map((element) =>
        element ? getElementVisibleRect(element, nextViewport) : null
      );
      const primaryElement = nextElements[0] ?? null;
      const primaryRect =
        primaryElement && hasUsableTutorialTargetArea(primaryElement, measuredRects[0] ?? null)
          ? (measuredRects[0] ?? null)
          : null;
      const nextRects = measuredRects.map((rect, index) => (index === 0 ? primaryRect : rect));
      if (
        presentation?.kind === 'ACTION' &&
        primaryElement &&
        nextRects[0] === null &&
        autoScrolledElement !== primaryElement
      ) {
        autoScrolledElement = primaryElement;
        if (scrollTutorialActionTargetIntoView(primaryElement, reduceMotion === true)) {
          scheduleUpdate();
        }
      }
      setTargetRects((current) => (sameRects(current, nextRects) ? current : nextRects));
      reportTargetVisibility(
        presentation?.interaction
          ? nextRects[0] !== null && nextRects[1] !== null
          : nextRects[0] !== null
      );
      setViewport((current) => (sameViewport(current, nextViewport) ? current : nextViewport));
    };

    const scheduleUpdate = () => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(update);
    };

    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: [
        'class',
        'hidden',
        BATTLE_UI_ANCHOR_ATTRIBUTE,
        BATTLE_UI_OBJECT_ATTRIBUTE,
        'data-object-id',
      ],
      childList: true,
      subtree: true,
    });
    const unsubscribeViewport = subscribeToBattleViewportChanges(scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    scheduleUpdate();

    return () => {
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      for (const element of [...elevatedHandItems.keys()]) restoreElevatedHandItem(element);
      unsubscribeViewport();
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [
    presentation?.interaction,
    presentation?.kind,
    presentation?.stepId,
    reduceMotion,
    reportTargetVisibility,
    targets,
  ]);

  useEffect(() => {
    const callout = calloutRef.current;
    if (!callout) return;
    const update = () => {
      const rect = callout.getBoundingClientRect();
      setCalloutSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(callout);
    update();
    return () => observer.disconnect();
  }, [presentation?.stepId]);

  const spotlightRects = useMemo(
    () =>
      targets.map((target, index) => {
        const rect = targetRects[index];
        return rect ? expandTutorialTargetRect(rect, target.padding ?? 8, viewport) : null;
      }),
    [targetRects, targets, viewport]
  );
  const primarySpotlightRect = spotlightRects[0] ?? null;
  const visibleSpotlightRects = spotlightRects.filter(
    (rect): rect is TutorialRect => rect !== null
  );
  const isCompactTransfer = presentation?.interaction?.kind === 'TRANSFER' && viewport.width < 768;
  const calloutLayout = useMemo(
    () =>
      placeTutorialCallout(
        primarySpotlightRect,
        calloutSize,
        viewport,
        presentation?.target?.placement ?? 'AUTO',
        visibleSpotlightRects
      ),
    [
      calloutSize,
      presentation?.target?.placement,
      primarySpotlightRect,
      viewport,
      visibleSpotlightRects,
    ]
  );
  const safeLeftMargin = 'max(12px, env(safe-area-inset-left))';
  const safeRightMargin = 'max(12px, env(safe-area-inset-right))';
  const safeTopMargin = 'max(12px, env(safe-area-inset-top))';
  const safeBottomMargin = 'max(12px, env(safe-area-inset-bottom))';
  const calloutWidth = `min(${isCompactTransfer ? '300px' : '360px'}, calc(100% - ${safeLeftMargin} - ${safeRightMargin}))`;
  const calloutMaxHeight = isCompactTransfer
    ? `min(96px, calc(100% - ${safeTopMargin} - ${safeBottomMargin}))`
    : `calc(100% - ${safeTopMargin} - ${safeBottomMargin})`;
  const renderedCalloutHeight = `min(${calloutSize.height}px, ${calloutMaxHeight})`;
  const hideTransferCallout =
    presentation?.interaction?.kind === 'TRANSFER' && calloutLayout.overlapsProtectedTarget;
  const calloutStyle = {
    left: `clamp(${safeLeftMargin}, ${calloutLayout.left}px, calc(100% - ${safeRightMargin} - ${calloutWidth}))`,
    top: `clamp(${safeTopMargin}, ${calloutLayout.top}px, calc(100% - ${safeBottomMargin} - ${renderedCalloutHeight}))`,
    width: calloutWidth,
    maxHeight: calloutMaxHeight,
    visibility: hideTransferCallout ? 'hidden' : 'visible',
  } as const;

  if (typeof document === 'undefined') return null;

  const overlay = (
    <AnimatePresence>
      {presentation && (
        <div
          className="pointer-events-none fixed z-[var(--z-tutorial-guidance)] overflow-hidden"
          data-tutorial-step={presentation.stepId}
          data-tutorial-guidance-overlay="true"
          style={{
            left: viewport.offsetLeft,
            top: viewport.offsetTop,
            width: viewport.width,
            height: viewport.height,
          }}
        >
          <style>{`[data-tutorial-elevated-hand-card="true"] { z-index: 50 !important; }`}</style>
          {visibleSpotlightRects.length > 1 ? (
            <>
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${viewport.width} ${viewport.height}`}
              >
                <defs>
                  <mask id={spotlightMaskId} maskUnits="userSpaceOnUse">
                    <rect width={viewport.width} height={viewport.height} fill="white" />
                    {visibleSpotlightRects.map((rect, index) => (
                      <rect
                        key={`${presentation.stepId}:mask:${index}`}
                        x={rect.left}
                        y={rect.top}
                        width={rect.width}
                        height={rect.height}
                        rx="12"
                        fill="black"
                      />
                    ))}
                  </mask>
                </defs>
                <rect
                  width={viewport.width}
                  height={viewport.height}
                  fill="rgba(3, 7, 18, 0.58)"
                  mask={`url(#${spotlightMaskId})`}
                />
              </svg>
              {visibleSpotlightRects.map((rect, index) => (
                <motion.div
                  key={`${presentation.stepId}:spotlight:${index}`}
                  aria-hidden="true"
                  data-tutorial-interaction-target={
                    presentation.interaction
                      ? index === 0
                        ? 'destination'
                        : index === 1
                          ? 'source'
                          : 'context'
                      : undefined
                  }
                  data-tutorial-spotlight-index={index}
                  data-tutorial-target-anchor={
                    targets[index]?.kind === 'ANCHOR' ? targets[index].anchor : undefined
                  }
                  data-tutorial-target-object-id={
                    targets[index]?.kind === 'OBJECT' ? targets[index].objectId : undefined
                  }
                  className="absolute rounded-xl border-2 border-[color:color-mix(in_srgb,var(--accent-gold)_86%,white)] shadow-[0_0_30px_color-mix(in_srgb,var(--accent-gold)_54%,transparent)]"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: reduceMotion ? 0.08 : 0.2,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              ))}
            </>
          ) : primarySpotlightRect ? (
            <motion.div
              aria-hidden="true"
              className="absolute rounded-xl border-2 border-[color:color-mix(in_srgb,var(--accent-gold)_86%,white)] shadow-[0_0_0_9999px_rgba(3,7,18,0.58),0_0_30px_color-mix(in_srgb,var(--accent-gold)_54%,transparent)]"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
              animate={{
                opacity: 1,
                scale: 1,
                left: primarySpotlightRect.left,
                top: primarySpotlightRect.top,
                width: primarySpotlightRect.width,
                height: primarySpotlightRect.height,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.08 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            />
          ) : (
            <motion.div
              aria-hidden="true"
              className="absolute inset-0 bg-slate-950/55"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.08 : 0.16 }}
            />
          )}

          <motion.section
            ref={calloutRef}
            aria-live="polite"
            aria-labelledby="tutorial-guidance-title"
            data-tutorial-callout="true"
            data-tutorial-callout-mode={
              hideTransferCallout ? 'HIDDEN_NO_SPACE' : isCompactTransfer ? 'COMPACT' : 'FULL'
            }
            className={cn(
              'absolute flex flex-col overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-gold)_42%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl',
              isCompactTransfer ? 'pointer-events-none' : 'pointer-events-auto'
            )}
            style={calloutStyle}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.985 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {isCompactTransfer ? (
              <div className="flex min-h-0 items-center gap-2.5 px-3 py-2.5">
                {onBack ? (
                  <button
                    type="button"
                    onClick={onBack}
                    className="button-ghost pointer-events-auto inline-flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--border-default)] p-0"
                    aria-label="上一步"
                    title="上一步"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : (
                  <MousePointer2
                    className="h-5 w-5 shrink-0 text-[var(--accent-gold)]"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <h2
                    id="tutorial-guidance-title"
                    className="line-clamp-1 text-sm font-bold leading-tight"
                  >
                    {presentation.title}
                  </h2>
                  <p className="mt-1 line-clamp-1 text-[11px] font-medium leading-tight text-[var(--text-secondary)]">
                    {presentation.statusText ?? presentation.body}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="cute-scrollbar touch-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-[var(--accent-gold)]">
                        {presentation.chapter} · {presentation.currentStep}/
                        {presentation.totalSteps}
                      </div>
                      <h2
                        id="tutorial-guidance-title"
                        className="mt-1 text-base font-bold leading-snug"
                      >
                        {presentation.title}
                      </h2>
                    </div>
                    {presentation.mascot ? (
                      <img
                        src={TUTORIAL_STICKER_ASSETS[presentation.mascot]}
                        alt=""
                        aria-hidden="true"
                        className="-mb-2 -mr-1 -mt-2 ml-auto h-16 w-16 shrink-0 object-contain"
                      />
                    ) : null}
                  </div>

                  <CardEffectText
                    text={presentation.body}
                    className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]"
                  />

                  {presentation.statusText && (
                    <div
                      className={cn(
                        'mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium',
                        presentation.kind === 'OBSERVE'
                          ? 'border-[color:color-mix(in_srgb,var(--semantic-info)_34%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-info)_10%,transparent)] text-[var(--semantic-info)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-secondary)]'
                      )}
                      role="status"
                    >
                      {presentation.kind === 'OBSERVE' ? (
                        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <MousePointer2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span>{presentation.statusText}</span>
                    </div>
                  )}
                  <div className="h-4 shrink-0" aria-hidden="true" />
                </div>

                {(onBack || (presentation.kind === 'INFO' && onContinue)) && (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_98%,transparent)] px-4 py-3">
                    {onBack ? (
                      <button
                        type="button"
                        onClick={onBack}
                        className="button-ghost inline-flex min-h-10 items-center justify-center gap-1.5 border border-[var(--border-default)] px-3 text-sm font-semibold"
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        上一步
                      </button>
                    ) : (
                      <span />
                    )}
                    {presentation.kind === 'INFO' && onContinue && (
                      <button
                        type="button"
                        onClick={onContinue}
                        className="button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm font-semibold"
                      >
                        {presentation.continueLabel ?? '下一步'}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(overlay, document.body);
});

export default TutorialGuidanceLayer;
