import { PresentationRoot } from '@/components/excel/PresentationRoot';
import { applyDocumentPresentation, installPresentationShortcut } from '@/lib/appPresentation';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { applyTheme, readTheme } from '@/lib/theme';
import { AppUpdateNotice } from '@/components/common/AppUpdateNotice';
import { startAppUpdateChecks } from '@/lib/appUpdateRegistration';
import { appUpdateCoordinator } from '@/lib/appUpdateCoordinator';
import { startDocumentNavigation } from '@/lib/appPerformance';
import { useGameStore } from '@/store/gameStore';

startDocumentNavigation(`${window.location.pathname}${window.location.search}`);
applyTheme(readTheme());
applyDocumentPresentation();
installPresentationShortcut();

function canApplyUpdateNow(state: ReturnType<typeof useGameStore.getState>): boolean {
  return (
    !state.playerViewState ||
    state.remoteSession?.source === 'SPECTATOR' ||
    state.replaySession !== null
  );
}

appUpdateCoordinator.setCanApplyUpdateNow(() => canApplyUpdateNow(useGameStore.getState()));

function AppRoot() {
  const updateAllowed = useGameStore(canApplyUpdateNow);

  return (
    <>
      <App />
      {updateAllowed ? <AppUpdateNotice canApplyUpdateNow /> : null}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PresentationRoot>
      <Suspense
        fallback={
          <div className="app-shell flex h-screen items-center justify-center px-4">
            <div className="text-center">
              <div className="normal-only mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--accent-primary)] border-t-transparent" />
              <p className="text-[var(--text-secondary)]">正在加载页面...</p>
            </div>
          </div>
        }
      >
        <AppRoot />
      </Suspense>
    </PresentationRoot>
  </StrictMode>
);

startAppUpdateChecks();
