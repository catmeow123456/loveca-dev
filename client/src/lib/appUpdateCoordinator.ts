import { useSyncExternalStore } from 'react';

export type AppUpdateStatus = 'IDLE' | 'CHECKING' | 'AVAILABLE' | 'APPLYING' | 'ERROR';

export interface AppUpdateState {
  readonly status: AppUpdateStatus;
  readonly currentBuildId: string;
  readonly latestBuildId: string | null;
  readonly waitingWorkerAvailable: boolean;
  readonly deferredBuildId: string | null;
  readonly error: string | null;
}

interface AppUpdateServiceWorkerActions {
  readonly checkForWaitingWorker: () => Promise<boolean>;
  readonly applyWaitingWorker: () => Promise<void>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface VersionResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

type VersionFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<VersionResponseLike>;

interface AppUpdateCoordinatorOptions {
  readonly currentBuildId: string;
  readonly storage?: StorageLike | null;
  readonly reload?: () => void;
  readonly warn?: (message: string, error: unknown) => void;
}

const DEFERRED_BUILD_STORAGE_KEY = 'loveca.app.update.deferred-build';
const UNKNOWN_UPDATE_BUILD_ID = '__loveca_waiting_service_worker__';
const VERSION_ENDPOINT = '/version.json';
const VERSION_REQUEST_TIMEOUT_MS = 5000;

export class AppUpdateCoordinator {
  private state: AppUpdateState;
  private readonly listeners = new Set<() => void>();
  private readonly storage: StorageLike | null;
  private readonly reload: () => void;
  private readonly warn: (message: string, error: unknown) => void;
  private serviceWorkerActions: AppUpdateServiceWorkerActions | null = null;
  private workerAlreadyControlsPage = false;
  private reloadRequested = false;

  constructor(options: AppUpdateCoordinatorOptions) {
    this.storage = options.storage ?? null;
    this.reload = options.reload ?? (() => undefined);
    this.warn = options.warn ?? ((message, error) => console.warn(message, error));
    this.state = {
      status: 'IDLE',
      currentBuildId: options.currentBuildId,
      latestBuildId: null,
      waitingWorkerAvailable: false,
      deferredBuildId: this.readDeferredBuildId(),
      error: null,
    };
  }

  readonly getState = (): AppUpdateState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setServiceWorkerActions(actions: AppUpdateServiceWorkerActions): void {
    this.serviceWorkerActions = actions;
  }

  markUpdateAvailable(
    input: {
      readonly latestBuildId?: string | null;
      readonly waitingWorkerAvailable?: boolean;
    } = {}
  ): void {
    const discoveredBuildId = input.latestBuildId?.trim() || null;
    const latestBuildId = discoveredBuildId ?? this.state.latestBuildId;
    const waitingWorkerAvailable =
      input.waitingWorkerAvailable ?? this.state.waitingWorkerAvailable;

    let deferredBuildId = this.state.deferredBuildId;
    if (deferredBuildId === UNKNOWN_UPDATE_BUILD_ID && discoveredBuildId) {
      deferredBuildId = discoveredBuildId;
      this.writeDeferredBuildId(discoveredBuildId);
    }

    const targetBuildId = latestBuildId ?? UNKNOWN_UPDATE_BUILD_ID;
    const isDeferred = deferredBuildId === targetBuildId;
    const status =
      this.state.status === 'APPLYING' ? 'APPLYING' : isDeferred ? 'IDLE' : 'AVAILABLE';

    this.setState({
      ...this.state,
      status,
      latestBuildId,
      waitingWorkerAvailable,
      deferredBuildId,
      error: status === 'AVAILABLE' ? null : this.state.error,
    });
  }

  deferCurrentUpdate(): void {
    if (this.state.status !== 'AVAILABLE') return;

    const deferredBuildId = this.state.latestBuildId ?? UNKNOWN_UPDATE_BUILD_ID;
    this.writeDeferredBuildId(deferredBuildId);
    this.setState({
      ...this.state,
      status: 'IDLE',
      deferredBuildId,
      error: null,
    });
  }

  async checkVersionManifest(fetcher: VersionFetcher = fetch): Promise<void> {
    const previousStatus = this.state.status;
    if (previousStatus === 'IDLE') {
      this.setState({ ...this.state, status: 'CHECKING' });
    }

    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller?.abort(), VERSION_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetcher(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' },
        signal: controller?.signal,
      });
      if (!response.ok) {
        throw new Error(`version fetch failed: ${response.status}`);
      }

      const payload = (await response.json()) as { buildId?: unknown };
      if (typeof payload.buildId !== 'string' || payload.buildId.trim() === '') {
        throw new Error('version payload missing buildId');
      }

      const latestBuildId = payload.buildId.trim();
      if (latestBuildId !== this.state.currentBuildId) {
        this.markUpdateAvailable({ latestBuildId });
      } else if (this.state.status === 'CHECKING') {
        this.setState({ ...this.state, status: 'IDLE', latestBuildId, error: null });
      }
    } catch (error) {
      this.warn('[version] background version check failed:', error);
      if (this.state.status === 'CHECKING') {
        this.setState({ ...this.state, status: 'IDLE' });
      }
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  async applyCurrentUpdate(): Promise<boolean> {
    if (this.state.status !== 'AVAILABLE') return false;

    this.setState({ ...this.state, status: 'APPLYING', error: null });

    if (this.workerAlreadyControlsPage) {
      this.reloadOnce();
      return true;
    }

    try {
      const actions = this.serviceWorkerActions;
      const waitingWorkerAvailable =
        this.state.waitingWorkerAvailable ||
        (actions ? await actions.checkForWaitingWorker() : false);

      if (!actions || !waitingWorkerAvailable) {
        this.setState({
          ...this.state,
          status: 'AVAILABLE',
          waitingWorkerAvailable: false,
          error: '更新已发现，请稍后重试。',
        });
        return false;
      }

      this.setState({ ...this.state, waitingWorkerAvailable: true });
      await actions.applyWaitingWorker();
      return true;
    } catch (error) {
      this.warn('[version] failed to apply update:', error);
      this.setState({
        ...this.state,
        status: 'AVAILABLE',
        error: '暂时无法完成更新，请稍后重试。',
      });
      return false;
    }
  }

  handleServiceWorkerControlChange(): void {
    if (this.state.status === 'APPLYING') {
      this.reloadOnce();
      return;
    }

    this.workerAlreadyControlsPage = true;
    this.markUpdateAvailable({ waitingWorkerAvailable: false });
  }

  private reloadOnce(): void {
    if (this.reloadRequested) return;
    this.reloadRequested = true;
    this.reload();
  }

  private setState(nextState: AppUpdateState): void {
    if (Object.is(this.state, nextState)) return;
    this.state = nextState;
    for (const listener of this.listeners) listener();
  }

  private readDeferredBuildId(): string | null {
    try {
      return this.storage?.getItem(DEFERRED_BUILD_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private writeDeferredBuildId(buildId: string): void {
    try {
      this.storage?.setItem(DEFERRED_BUILD_STORAGE_KEY, buildId);
    } catch {
      // A blocked sessionStorage must not turn an optional update prompt into an app error.
    }
  }
}

const runtimeBuildId =
  typeof __APP_BUILD_ID__ === 'undefined' ? 'unknown-current-build' : __APP_BUILD_ID__;

function getRuntimeStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const appUpdateCoordinator = new AppUpdateCoordinator({
  currentBuildId: runtimeBuildId,
  storage: getRuntimeStorage(),
  reload: () => window.location.reload(),
});

export function useAppUpdateState(): AppUpdateState {
  return useSyncExternalStore(
    appUpdateCoordinator.subscribe,
    appUpdateCoordinator.getState,
    appUpdateCoordinator.getState
  );
}
