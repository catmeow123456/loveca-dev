import { registerSW } from 'virtual:pwa-register';
import { appUpdateCoordinator } from '@/lib/appUpdateCoordinator';

const UPDATE_CHECK_INTERVAL_MS = 60_000;

export function startAppUpdateChecks(): () => void {
  let registration: ServiceWorkerRegistration | undefined;
  let intervalId: number | null = null;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      void appUpdateCoordinator.checkVersionManifest().finally(() => {
        appUpdateCoordinator.markUpdateAvailable({ waitingWorkerAvailable: true });
      });
    },
    onNeedReload: () => {
      appUpdateCoordinator.handleServiceWorkerControlChange();
    },
    onRegisteredSW: (_swScriptUrl, nextRegistration) => {
      registration = nextRegistration;
      void runUpdateChecks();
      if (intervalId === null) {
        intervalId = window.setInterval(runUpdateChecks, UPDATE_CHECK_INTERVAL_MS);
      }
    },
    onRegisterError: (error) => {
      console.warn('[pwa] service worker registration failed:', error);
    },
  });

  const checkForWaitingWorker = async (): Promise<boolean> => {
    if (!registration) return false;
    if (registration.waiting) return true;
    await registration.update();
    return Boolean(registration.waiting);
  };

  appUpdateCoordinator.setServiceWorkerActions({
    checkForWaitingWorker,
    applyWaitingWorker: () => updateSW(),
  });

  async function runUpdateChecks(): Promise<void> {
    const checks: Promise<unknown>[] = [appUpdateCoordinator.checkVersionManifest()];
    if (registration) checks.push(registration.update());
    await Promise.allSettled(checks);
  }

  void appUpdateCoordinator.checkVersionManifest();

  return () => {
    if (intervalId !== null) window.clearInterval(intervalId);
  };
}
