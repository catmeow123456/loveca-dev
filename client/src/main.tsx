import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { applyTheme, readTheme } from '@/lib/theme';
import { MotionConfig } from 'framer-motion';
import { AppUpdateNotice } from '@/components/common/AppUpdateNotice';
import { startAppUpdateChecks } from '@/lib/appUpdateRegistration';
import { useGameStore } from '@/store/gameStore';

applyTheme(readTheme());

function AppRoot() {
  const canApplyUpdateNow = useGameStore(
    (state) =>
      !state.playerViewState ||
      state.remoteSession?.source === 'SPECTATOR' ||
      state.replaySession !== null
  );

  return (
    <>
      <App />
      {canApplyUpdateNow ? <AppUpdateNotice canApplyUpdateNow /> : null}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Suspense
        fallback={
          <div className="app-shell flex h-screen items-center justify-center px-4">
            <div className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--accent-primary)] border-t-transparent" />
              <p className="text-[var(--text-secondary)]">正在加载页面...</p>
            </div>
          </div>
        }
      >
        <AppRoot />
      </Suspense>
    </MotionConfig>
  </StrictMode>
);

startAppUpdateChecks();
