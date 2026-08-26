export const APP_PERFORMANCE_PREFIX = 'loveca:';

export const APP_PERFORMANCE_ENTRY_NAMES = {
  navigationStart: `${APP_PERFORMANCE_PREFIX}navigation:start`,
  surfaceReady: `${APP_PERFORMANCE_PREFIX}navigation:surface-ready`,
  dataRequestStart: `${APP_PERFORMANCE_PREFIX}data:request-start`,
  dataReady: `${APP_PERFORMANCE_PREFIX}navigation:data-ready`,
  backgroundRefreshComplete: `${APP_PERFORMANCE_PREFIX}data:background-refresh-complete`,
  navigationToSurface: `${APP_PERFORMANCE_PREFIX}measure:navigation-to-surface`,
  navigationToData: `${APP_PERFORMANCE_PREFIX}measure:navigation-to-data`,
} as const;

export type AppNavigationTrigger = 'document-load' | 'app-page-state';
export type AppDataLoadMode = 'cold' | 'cache-fresh' | 'cache-stale' | 'background';
export type AppDataOutcome = 'success' | 'error';

type AppPerformanceMetadata = Readonly<Record<string, unknown>>;

interface ActiveNavigation {
  readonly id: string;
  readonly from: string;
  readonly requestedTarget: string;
  readonly trigger: AppNavigationTrigger;
  readonly startedAt: number;
  surfaceReadyMeasured: boolean;
  dataReadyMeasured: boolean;
}

let activeNavigation: ActiveNavigation | null = null;
let navigationSequence = 0;

function getPerformance(): Performance | null {
  const candidate = globalThis.performance;
  if (
    !candidate ||
    typeof candidate.mark !== 'function' ||
    typeof candidate.measure !== 'function'
  ) {
    return null;
  }
  return candidate;
}

function createNavigationId(): string {
  navigationSequence += 1;
  return `${Date.now().toString(36)}-${navigationSequence.toString(36)}`;
}

function mark(
  name: (typeof APP_PERFORMANCE_ENTRY_NAMES)[keyof typeof APP_PERFORMANCE_ENTRY_NAMES],
  detail: AppPerformanceMetadata
): PerformanceMark | null {
  const target = getPerformance();
  if (!target) return null;

  try {
    return target.mark(name, { detail });
  } catch {
    return null;
  }
}

function measure(
  name:
    | typeof APP_PERFORMANCE_ENTRY_NAMES.navigationToSurface
    | typeof APP_PERFORMANCE_ENTRY_NAMES.navigationToData,
  start: number,
  end: number,
  detail: AppPerformanceMetadata
): void {
  const target = getPerformance();
  if (!target) return;

  try {
    target.measure(name, { start, end, detail });
  } catch {
    // Performance instrumentation must never affect application behavior.
  }
}

export function startAppNavigation(
  from: string,
  requestedTarget: string,
  trigger: AppNavigationTrigger = 'app-page-state'
): string | null {
  const navigationId = createNavigationId();
  const detail = { navigationId, from, requestedTarget, trigger };
  const entry = mark(APP_PERFORMANCE_ENTRY_NAMES.navigationStart, detail);
  const target = getPerformance();
  if (!entry && !target) return null;

  activeNavigation = {
    id: navigationId,
    from,
    requestedTarget,
    trigger,
    startedAt: entry?.startTime ?? target?.now() ?? 0,
    surfaceReadyMeasured: false,
    dataReadyMeasured: false,
  };
  return navigationId;
}

export function startDocumentNavigation(target: string): string | null {
  return startAppNavigation('document', target, 'document-load');
}

export function markAppSurfaceReady(surface: string): void {
  const navigation = activeNavigation;
  const detail = {
    navigationId: navigation?.id ?? null,
    surface,
    requestedTarget: navigation?.requestedTarget ?? null,
    trigger: navigation?.trigger ?? null,
  };
  const entry = mark(APP_PERFORMANCE_ENTRY_NAMES.surfaceReady, detail);
  if (!navigation || !entry || navigation.surfaceReadyMeasured) return;

  const matchesTarget =
    navigation.trigger === 'document-load' || navigation.requestedTarget === surface;
  if (!matchesTarget) return;

  navigation.surfaceReadyMeasured = true;
  measure(
    APP_PERFORMANCE_ENTRY_NAMES.navigationToSurface,
    navigation.startedAt,
    entry.startTime,
    detail
  );
}

export function markAppDataRequestStart(
  source: string,
  mode: AppDataLoadMode,
  metadata: AppPerformanceMetadata = {}
): void {
  mark(APP_PERFORMANCE_ENTRY_NAMES.dataRequestStart, {
    navigationId: activeNavigation?.id ?? null,
    source,
    mode,
    ...metadata,
  });
}

export function markAppDataReady(
  source: string,
  mode: AppDataLoadMode,
  metadata: AppPerformanceMetadata = {}
): void {
  const navigation = activeNavigation;
  const detail = {
    navigationId: navigation?.id ?? null,
    source,
    mode,
    ...metadata,
  };
  const entry = mark(APP_PERFORMANCE_ENTRY_NAMES.dataReady, detail);
  if (!navigation || !entry || navigation.dataReadyMeasured) return;

  navigation.dataReadyMeasured = true;
  measure(
    APP_PERFORMANCE_ENTRY_NAMES.navigationToData,
    navigation.startedAt,
    entry.startTime,
    detail
  );
}

export function markAppBackgroundRefreshComplete(
  source: string,
  outcome: AppDataOutcome,
  metadata: AppPerformanceMetadata = {}
): void {
  mark(APP_PERFORMANCE_ENTRY_NAMES.backgroundRefreshComplete, {
    navigationId: activeNavigation?.id ?? null,
    source,
    outcome,
    ...metadata,
  });
}

export function resetAppPerformanceForTests(): void {
  activeNavigation = null;
  navigationSequence = 0;
  const target = getPerformance();
  target?.clearMarks();
  target?.clearMeasures();
}
