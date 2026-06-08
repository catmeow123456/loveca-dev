import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

let hasRefreshedForUpdate = false;
const VERSION_STORAGE_KEY = 'loveca.app.version';
const BUILD_STORAGE_KEY = 'loveca.app.build';
const VERSION_RELOAD_FLAG = 'loveca.app.version.reload';
const VERSION_ENDPOINT = '/version.json';
const CACHE_PREFIXES = [
  'loveca-',
  'remote-card-images-',
  'remote-static-assets-',
  'local-card-images-',
  'energy-card-images-',
  'compressed-card-images-',
];

async function clearRuntimeCaches(): Promise<void> {
  if (!('caches' in window)) {
    return;
  }

  const cacheKeys = await window.caches.keys();
  const appCacheKeys = cacheKeys.filter((key) =>
    CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
  await Promise.all(appCacheKeys.map((key) => window.caches.delete(key)));
}

async function updateServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.update()));
}

function reloadWithCacheBust(targetBuildId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('v', targetBuildId);
  window.sessionStorage.setItem(VERSION_RELOAD_FLAG, targetBuildId);
  window.location.replace(url.toString());
}

async function enforceLatestVersion(): Promise<void> {
  const alreadyReloadedForBuild = window.sessionStorage.getItem(VERSION_RELOAD_FLAG);
  if (alreadyReloadedForBuild === __APP_BUILD_ID__) {
    window.sessionStorage.removeItem(VERSION_RELOAD_FLAG);
  }

  const currentVersion = __APP_VERSION__;
  const currentBuildId = __APP_BUILD_ID__;
  const storedBuildId =
    window.localStorage.getItem(BUILD_STORAGE_KEY) ??
    window.localStorage.getItem(VERSION_STORAGE_KEY);

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

    const payload = (await response.json()) as { version?: string; buildId?: string };
    const latestVersion = payload.version;
    const latestBuildId = payload.buildId ?? latestVersion;

    if (!latestVersion || !latestBuildId) {
      throw new Error('version payload missing version/buildId');
    }

    if (latestBuildId !== currentBuildId) {
      if (alreadyReloadedForBuild === latestBuildId) {
        throw new Error(`version reload loop prevented: ${currentBuildId} -> ${latestBuildId}`);
      }

      await Promise.allSettled([clearRuntimeCaches(), updateServiceWorkers()]);
      window.localStorage.setItem(VERSION_STORAGE_KEY, latestVersion);
      window.localStorage.setItem(BUILD_STORAGE_KEY, latestBuildId);
      reloadWithCacheBust(latestBuildId);
      return;
    }

    if (storedBuildId !== currentBuildId) {
      window.localStorage.setItem(VERSION_STORAGE_KEY, currentVersion);
      window.localStorage.setItem(BUILD_STORAGE_KEY, currentBuildId);
    }
  } catch (error) {
    if (storedBuildId && storedBuildId !== currentBuildId) {
      await Promise.allSettled([clearRuntimeCaches(), updateServiceWorkers()]);
      window.localStorage.setItem(VERSION_STORAGE_KEY, currentVersion);
      window.localStorage.setItem(BUILD_STORAGE_KEY, currentBuildId);
      reloadWithCacheBust(currentBuildId);
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
