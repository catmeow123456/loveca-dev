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
  placeTutorialCallout,
  type TutorialGuidancePresentation,
  type TutorialGuidanceTarget,
  type TutorialRect,
} from '@/lib/tutorialGuidance';
import { TUTORIAL_STICKER_ASSETS } from '@/lib/tutorialMascotAssets';
import { cn } from '@/lib/utils';

export interface TutorialGuidanceLayerProps {
  readonly presentation: TutorialGuidancePresentation | null;
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
  readonly onTargetVisibilityChange?: (visible: boolean) => void;
}

function isElementVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  );
}

function findVisibleElementByAttribute(attribute: string, value: string): HTMLElement | null {
  const elements = document.querySelectorAll<HTMLElement>(`[${attribute}]`);
  for (const element of elements) {
    if (element.getAttribute(attribute) === value && isElementVisible(element)) {
      return element;
    }
  }
  return null;
}

function resolveTutorialTarget(target: TutorialGuidanceTarget): HTMLElement | null {
  if (target.kind === 'ANCHOR') {
    return findVisibleElementByAttribute(BATTLE_UI_ANCHOR_ATTRIBUTE, target.anchor);
  }

  const normalizedObjectId = target.objectId.replace(/^obj_/, '');
  const explicitObject = findVisibleElementByAttribute(
    BATTLE_UI_OBJECT_ATTRIBUTE,
    normalizedObjectId
  );
  if (explicitObject) return explicitObject;

  return (
    findVisibleElementByAttribute('data-object-id', `obj_${normalizedObjectId}`) ??
    findVisibleElementByAttribute('data-object-id', normalizedObjectId)
  );
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
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));

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

      const nextRects = nextElements.map((element) =>
        element ? toTutorialRect(element.getBoundingClientRect()) : null
      );
      setTargetRects((current) => (sameRects(current, nextRects) ? current : nextRects));
      reportTargetVisibility(nextRects.every((rect) => rect !== null));
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    const scheduleUpdate = () => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(update);
    };

    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    scheduleUpdate();

    return () => {
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      for (const element of [...elevatedHandItems.keys()]) restoreElevatedHandItem(element);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [presentation?.stepId, reportTargetVisibility, targets]);

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

  if (typeof document === 'undefined') return null;

  const overlay = (
    <AnimatePresence>
      {presentation && (
        <div
          className="pointer-events-none fixed inset-0 z-[120]"
          data-tutorial-step={presentation.stepId}
        >
          <style>{`[data-tutorial-elevated-hand-card="true"] { z-index: 50 !important; }`}</style>
          {visibleSpotlightRects.length > 1 ? (
            <>
              <svg
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 h-full w-full"
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
                  className="fixed rounded-xl border-2 border-[color:color-mix(in_srgb,var(--accent-gold)_86%,white)] shadow-[0_0_30px_color-mix(in_srgb,var(--accent-gold)_54%,transparent)]"
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
              className="fixed rounded-xl border-2 border-[color:color-mix(in_srgb,var(--accent-gold)_86%,white)] shadow-[0_0_0_9999px_rgba(3,7,18,0.58),0_0_30px_color-mix(in_srgb,var(--accent-gold)_54%,transparent)]"
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
              className="fixed inset-0 bg-slate-950/55"
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
            className="pointer-events-auto fixed w-[min(360px,calc(100vw-24px))] rounded-xl border border-[color:color-mix(in_srgb,var(--accent-gold)_42%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.985 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              left: calloutLayout.left,
              top: calloutLayout.top,
            }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-[var(--accent-gold)]">
                  {presentation.chapter} · {presentation.currentStep}/{presentation.totalSteps}
                </div>
                <h2 id="tutorial-guidance-title" className="mt-1 text-base font-bold leading-snug">
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

            {(onBack || (presentation.kind === 'INFO' && onContinue)) && (
              <div className="mt-4 flex items-center justify-between gap-3">
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
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(overlay, document.body);
});

export default TutorialGuidanceLayer;
