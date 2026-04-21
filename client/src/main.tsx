import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

let hasRefreshedForUpdate = false;
const VERSION_STORAGE_KEY = 'loveca.app.version';
const VERSION_RELOAD_FLAG = 'loveca.app.version.reload';
const VERSION_ENDPOINT = '/version.json';

async function clearRuntimeCaches(): Promise<void> {
  if (!('caches' in window)) {
    return;
  }

  const cacheKeys = await window.caches.keys();
  await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
}

async function unregisterServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

function reloadWithCacheBust(targetVersion: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('v', targetVersion);
  window.sessionStorage.setItem(VERSION_RELOAD_FLAG, targetVersion);
  window.location.replace(url.toString());
}

async function enforceLatestVersion(): Promise<void> {
  const alreadyReloadedForVersion = window.sessionStorage.getItem(VERSION_RELOAD_FLAG);
  if (alreadyReloadedForVersion === __APP_VERSION__) {
    window.sessionStorage.removeItem(VERSION_RELOAD_FLAG);
  }

  const currentVersion = __APP_VERSION__;
  const storedVersion = window.localStorage.getItem(VERSION_STORAGE_KEY);

  try {
    const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'cache-control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`version fetch failed: ${response.status}`);
    }

    const payload = (await response.json()) as { version?: string };
    const latestVersion = payload.version;

    if (!latestVersion) {
      throw new Error('version payload missing version');
    }

    if (latestVersion !== currentVersion) {
      if (alreadyReloadedForVersion === latestVersion) {
        throw new Error(`version reload loop prevented: ${currentVersion} -> ${latestVersion}`);
      }

      await Promise.all([clearRuntimeCaches(), unregisterServiceWorkers()]);
      window.localStorage.setItem(VERSION_STORAGE_KEY, latestVersion);
      reloadWithCacheBust(latestVersion);
      return;
    }

    if (storedVersion !== currentVersion) {
      window.localStorage.setItem(VERSION_STORAGE_KEY, currentVersion);
    }
  } catch (error) {
    if (storedVersion && storedVersion !== currentVersion) {
      await Promise.allSettled([clearRuntimeCaches(), unregisterServiceWorkers()]);
      window.localStorage.setItem(VERSION_STORAGE_KEY, currentVersion);
      reloadWithCacheBust(currentVersion);
      return;
    }

    console.warn('[version] skip forced refresh:', error);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasRefreshedForUpdate) return;
    hasRefreshedForUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;

      void registration.update();
      window.setInterval(() => {
        void registration.update();
      }, 60_000);
    });
  });
}

void enforceLatestVersion().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
