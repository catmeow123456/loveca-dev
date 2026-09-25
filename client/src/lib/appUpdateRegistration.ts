import { appUpdateCoordinator, type AppUpdateCoordinator } from '@/lib/appUpdateCoordinator';

const UPDATE_CHECK_INTERVAL_MS = 60_000;

// Observe browser state, not just the completion of registration.update(): that
// promise can resolve while the new worker is still installing its precache.
function waitForWorker<T>(
  registration: ServiceWorkerRegistration,
  container: ServiceWorkerContainer,
  signal: AbortSignal,
  inspect: () => T | undefined,
  start?: () => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const workers = new Set<ServiceWorker>();
    const cleanup = () => {
      registration.removeEventListener('updatefound', check);
      container.removeEventListener('controllerchange', check);
      signal.removeEventListener('abort', abort);
      for (const worker of workers) worker.removeEventListener('statechange', check);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const check = () => {
      for (const worker of [registration.installing, registration.waiting, registration.active]) {
        if (worker && !workers.has(worker)) {
          workers.add(worker);
          worker.addEventListener('statechange', check);
        }
      }
      try {
        const result = inspect();
        if (result !== undefined) {
          cleanup();
          resolve(result);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    if (signal.aborted) return abort();
    registration.addEventListener('updatefound', check);
    container.addEventListener('controllerchange', check);
    signal.addEventListener('abort', abort, { once: true });
    try {
      start?.();
      check();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function startAppUpdateChecks(
  coordinator: AppUpdateCoordinator = appUpdateCoordinator,
  container: ServiceWorkerContainer | undefined = import.meta.env.PROD
    ? navigator.serviceWorker
    : undefined
): () => void {
  let registration: ServiceWorkerRegistration | undefined;
  let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;
  let disposed = false;
  const initialController = container?.controller;
  let previousController = initialController;
  const observedWorkers = new Set<ServiceWorker>();

  const refreshWaitingState = () => {
    if (disposed || !registration) return;
    if (registration.waiting) coordinator.markUpdateAvailable({ waitingWorkerAvailable: true });
    const worker = registration.installing;
    if (worker && !observedWorkers.has(worker)) {
      observedWorkers.add(worker);
      worker.addEventListener('statechange', refreshWaitingState);
    }
  };
  const onControlChange = () => {
    const next = container?.controller;
    if (next && next !== previousController) {
      // A first installation on an already current page is not an app update.
      const state = coordinator.getState();
      if (
        previousController ||
        (state.latestBuildId && state.latestBuildId !== state.currentBuildId)
      ) {
        coordinator.handleServiceWorkerControlChange();
      }
    }
    previousController = next;
  };
  container?.addEventListener('controllerchange', onControlChange);

  const ensureRegistration = async (): Promise<ServiceWorkerRegistration> => {
    if (!container) throw new Error('浏览器无法使用自动更新，请关闭所有 Loveca 页面后重新打开。');
    if (registration) return registration;
    if (!registrationPromise) {
      // Reuse the generated prompt worker, but own its lifecycle so failed
      // registration can be retried without accumulating Workbox listeners.
      registrationPromise = container
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          scope: import.meta.env.BASE_URL,
          updateViaCache: 'none',
        })
        .then((result) => {
          registration = result;
          if (!disposed) {
            result.addEventListener('updatefound', refreshWaitingState);
            refreshWaitingState();
          }
          return result;
        })
        .finally(() => {
          registrationPromise = undefined;
        });
    }
    try {
      return await registrationPromise;
    } catch {
      throw new Error('更新服务注册失败，请检查网络或浏览器设置后重试。');
    }
  };

  coordinator.setServiceWorkerActions({
    prepareUpdate: async (signal) => {
      const current = await ensureRegistration();
      signal.throwIfAborted();
      if (!current.waiting && !current.installing) {
        try {
          await current.update();
        } catch {
          throw new Error('无法下载新版，请检查网络后重试。');
        }
      }
      signal.throwIfAborted();
      return waitForWorker(current, container!, signal, () => {
        if (current.waiting) return 'waiting' as const;
        if (container!.controller && container!.controller !== initialController)
          return 'reload' as const;
        // First registration may activate without waiting or claiming this tab.
        if (!container!.controller && current.active?.state === 'activated')
          return 'reload' as const;
        if (current.active?.state === 'activating') return undefined;
        if (!current.installing || current.installing.state === 'redundant') {
          throw new Error(
            '未找到可切换的新版，请重试；若仍失败，请关闭所有 Loveca 页面后重新打开。'
          );
        }
        return undefined;
      });
    },
    applyWaitingWorker: async (signal) => {
      const current = await ensureRegistration();
      signal.throwIfAborted();
      const worker = current.waiting;
      if (!worker) {
        if (container!.controller && container!.controller !== initialController) return;
        throw new Error('更新状态已变化，请重试。');
      }
      await waitForWorker(
        current,
        container!,
        signal,
        () => {
          if (container!.controller === worker) return true;
          if (!container!.controller && worker.state === 'activated') return true;
          if (worker.state === 'redundant') throw new Error('新版切换失败，请重试。');
          return undefined;
        },
        () => worker.postMessage({ type: 'SKIP_WAITING' })
      );
    },
  });

  async function runUpdateChecks(): Promise<void> {
    const checks: Promise<unknown>[] = [coordinator.checkVersionManifest()];
    if (container) checks.push(ensureRegistration().then((current) => current.update()));
    await Promise.allSettled(checks);
  }
  void runUpdateChecks();
  const intervalId = window.setInterval(() => void runUpdateChecks(), UPDATE_CHECK_INTERVAL_MS);

  return () => {
    disposed = true;
    window.clearInterval(intervalId);
    container?.removeEventListener('controllerchange', onControlChange);
    registration?.removeEventListener('updatefound', refreshWaitingState);
    for (const worker of observedWorkers)
      worker.removeEventListener('statechange', refreshWaitingState);
  };
}
