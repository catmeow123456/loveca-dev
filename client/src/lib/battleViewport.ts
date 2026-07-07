export interface BattleViewportSignature {
  readonly width: number;
  readonly height: number;
  readonly offsetTop: number;
  readonly offsetLeft: number;
  readonly scale: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

interface BattleHitTestElementSummary {
  readonly tagName: string;
  readonly id: string | null;
  readonly role: string | null;
  readonly zoneId: string | null;
  readonly objectId: string | null;
  readonly testId: string | null;
  readonly className: string | null;
  readonly zIndex: string | null;
  readonly pointerEvents: string | null;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

interface BattleHitTestDiagnostics {
  readonly viewport: BattleViewportSignature | null;
  readonly point: { readonly x: number; readonly y: number };
  readonly element: BattleHitTestElementSummary | null;
  readonly stack: readonly BattleHitTestElementSummary[];
}

interface BattleViewportDebugWindow extends Window {
  __lovecaBattleViewport?: () => BattleViewportSignature | null;
  __lovecaBattleHitTest?: (x?: number, y?: number) => BattleHitTestDiagnostics;
}

export const BATTLE_VIEWPORT_PIXEL_THRESHOLD = 2;
export const BATTLE_VIEWPORT_SCALE_THRESHOLD = 0.01;

export function readBattleViewportSignature(): BattleViewportSignature | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const visualViewport = window.visualViewport;
  return {
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
    offsetTop: visualViewport?.offsetTop ?? 0,
    offsetLeft: visualViewport?.offsetLeft ?? 0,
    scale: visualViewport?.scale ?? 1,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
}

export function hasBattleViewportSignatureChanged(
  previous: BattleViewportSignature | null,
  next: BattleViewportSignature | null,
  pixelThreshold = BATTLE_VIEWPORT_PIXEL_THRESHOLD,
  scaleThreshold = BATTLE_VIEWPORT_SCALE_THRESHOLD
): boolean {
  if (!previous || !next) {
    return false;
  }

  return (
    Math.abs(previous.width - next.width) > pixelThreshold ||
    Math.abs(previous.height - next.height) > pixelThreshold ||
    Math.abs(previous.offsetTop - next.offsetTop) > pixelThreshold ||
    Math.abs(previous.offsetLeft - next.offsetLeft) > pixelThreshold ||
    Math.abs(previous.innerWidth - next.innerWidth) > pixelThreshold ||
    Math.abs(previous.innerHeight - next.innerHeight) > pixelThreshold ||
    Math.abs(previous.scale - next.scale) > scaleThreshold
  );
}

export function isBattleViewportInteractionInvalidated(
  startSignature: BattleViewportSignature | null,
  currentSignature: BattleViewportSignature | null,
  alreadyInvalidated: boolean
): boolean {
  return (
    alreadyInvalidated || hasBattleViewportSignatureChanged(startSignature, currentSignature)
  );
}

export function subscribeToBattleViewportChanges(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener('resize', listener);
  visualViewport?.addEventListener('scroll', listener);
  window.addEventListener('resize', listener);
  window.addEventListener('orientationchange', listener);

  return () => {
    visualViewport?.removeEventListener('resize', listener);
    visualViewport?.removeEventListener('scroll', listener);
    window.removeEventListener('resize', listener);
    window.removeEventListener('orientationchange', listener);
  };
}

export function installBattleViewportDiagnostics(enabled: boolean): () => void {
  if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const debugWindow = window as BattleViewportDebugWindow;
  const previousViewport = debugWindow.__lovecaBattleViewport;
  const previousHitTest = debugWindow.__lovecaBattleHitTest;

  debugWindow.__lovecaBattleViewport = readBattleViewportSignature;
  debugWindow.__lovecaBattleHitTest = (x = window.innerWidth / 2, y = window.innerHeight / 2) => {
    const stack = document.elementsFromPoint(x, y).map(summarizeHitTestElement);
    return {
      viewport: readBattleViewportSignature(),
      point: { x, y },
      element: stack[0] ?? null,
      stack,
    };
  };

  return () => {
    if (previousViewport) {
      debugWindow.__lovecaBattleViewport = previousViewport;
    } else {
      delete debugWindow.__lovecaBattleViewport;
    }
    if (previousHitTest) {
      debugWindow.__lovecaBattleHitTest = previousHitTest;
    } else {
      delete debugWindow.__lovecaBattleHitTest;
    }
  };
}

function summarizeHitTestElement(element: Element): BattleHitTestElementSummary {
  const htmlElement = element instanceof HTMLElement ? element : null;
  const rect = element.getBoundingClientRect();
  const computedStyle = htmlElement ? window.getComputedStyle(htmlElement) : null;

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    role: element.getAttribute('role'),
    zoneId: element.getAttribute('data-zone-id'),
    objectId: element.getAttribute('data-object-id'),
    testId: element.getAttribute('data-testid'),
    className: typeof element.className === 'string' ? element.className : null,
    zIndex: computedStyle?.zIndex ?? null,
    pointerEvents: computedStyle?.pointerEvents ?? null,
    rect: {
      left: roundDiagnosticNumber(rect.left),
      top: roundDiagnosticNumber(rect.top),
      width: roundDiagnosticNumber(rect.width),
      height: roundDiagnosticNumber(rect.height),
    },
  };
}

function roundDiagnosticNumber(value: number): number {
  return Math.round(value * 100) / 100;
}
